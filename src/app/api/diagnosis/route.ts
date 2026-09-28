import { NextRequest, NextResponse } from "next/server";
import { runFreeDiagnosis, InvalidDiagnosisInputError } from "@/server/services/runFreeDiagnosis";
import { UnavailableAiProvider } from "@/server/providers/ai/unavailableAiProvider";
import { UnavailableCompetitorProvider } from "@/server/providers/competitor/unavailableCompetitorProvider";
import { UnavailableScoreProvider } from "@/server/providers/scoring/unavailableScoreProvider";
import { UnavailableAdComplianceProvider } from "@/server/providers/ad-compliance/unavailableAdComplianceProvider";
import {
  saveDiagnosisResult,
  updateDiagnosisResultEmailStatus,
} from "@/server/db/diagnosisRepository";
import {
  resolveAiMeasurementConfigFromProcessEnv,
  AiMeasurementConfigError,
} from "@/server/config/aiMeasurementConfig";
import { createAiMeasurementProviderFromConfig } from "@/server/composition/aiMeasurementProviderFactory";
import { getCurrentContact } from "@/server/auth/session";
import { findClinicDuplicateCandidate } from "@/server/db/clinicDuplicateRepository";
import { duplicateCandidateMessage } from "@/domain/clinic/duplicateDetection";
import { sendDiagnosisResultEmail } from "@/server/services/sendDiagnosisResultEmail";
import type { ResultEmailDeliveryStatus } from "@/domain/email/resultEmailDeliveryStatus";
import { enqueueIntegrationEvent } from "@/server/db/integrationEventRepository";
import { sanitizeUtmAttribution } from "@/domain/marketing/utmAttribution";

// 2026-09-27修正(PO承認): 通常診断からMockAiProviderを除外する。疑似乱数による
// 言及・順位・競合言及の捏造を正式スコア・患者質問結果・根拠文言へ混入させない
// (MockAiProvider自体は削除せず、ユニットテスト・fixture・明示的なデモモード専用として残す)。
// canonical aiMeasurementProvider(下記)による実測は、2026-09-08承認の分離設計により
// 引き続きスコアへは接続しない(patientQuestion単位の事実表示にのみ使う)。
const aiProvider = new UnavailableAiProvider();
// 2026-09-24のユーザー指示: 近隣競合比較・医療広告AIチェックは実データ取得基盤が
// 未実装のため、架空の競合医院名やダミーのリスク判定を本番で表示しない。実装完了までは
// 常に空配列を返すUnavailable系providerを使う(UI側は「準備中」表示にフォールバックする)。
const competitorProvider = new UnavailableCompetitorProvider();
// 2026-09-24のユーザー指示: 6領域スコアの疑似乱数生成(MockScoreProvider)も本番経路から
// 除外する。実測AI観測に基づくAIOの一部criterionのみ算出し、それ以外はunavailableとする。
const scoreProvider = new UnavailableScoreProvider();
const adComplianceProvider = new UnavailableAdComplianceProvider();

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "リクエストボディがJSONとして解釈できません" }, { status: 400 });
  }

  const {
    clinicName,
    directorName,
    clinicUrl,
    contactEmail,
    contactPhone,
    gbpUrl,
    bookingUrl,
    allowDuplicateClinic,
  } =
    (body ?? {}) as Record<string, unknown>;

  // 2026-09-24: Instagram等の流入チャネル別に診断「開始」と「完了」を比較するためのUTM値
  // (5項目)。diagnosis_started(開始)と同じsanitizeUtmAttribution()を使い、
  // 同じ入力からは常に同じ形の値を出す(未指定時はnull=直接流入・既存LP経由など)。
  const utmFields = sanitizeUtmAttribution((body ?? {}) as Record<string, unknown>);

  if (allowDuplicateClinic !== undefined && typeof allowDuplicateClinic !== "boolean") {
    return NextResponse.json({ error: "重複確認の値が不正です" }, { status: 400 });
  }

  // 先にセッションと重複候補を確認し、重複時は外部AI計測を開始しない。
  // 候補IDは公開せず、既存Clinicへ自動統合もしない。
  let currentContact: Awaited<ReturnType<typeof getCurrentContact>>;
  try {
    currentContact = await getCurrentContact();
    if (!currentContact && allowDuplicateClinic !== true) {
      const candidate = await findClinicDuplicateCandidate({
        clinicName: String(clinicName ?? "").trim(),
        clinicUrl: String(clinicUrl ?? "").trim(),
      });
      if (candidate) {
        return NextResponse.json(
          {
            error: duplicateCandidateMessage(candidate.matchType),
            code: "clinic_duplicate_candidate",
            matchType: candidate.matchType,
          },
          { status: 409 }
        );
      }
    }
  } catch (err) {
    console.error("[POST /api/diagnosis] clinic duplicate check error", err);
    return NextResponse.json(
      { error: "医院情報の確認中にエラーが発生しました。時間をおいて再度お試しください。" },
      { status: 500 }
    );
  }

  // canonical AI計測provider(OpenAI実測overlay)のcomposition。
  //
  // 2026-09-27修正(PO承認、P0優先): 2026-09-08時点ではAI_MEASUREMENT_PROVIDER未設定・
  // 不正値・API key/model欠落を診断リクエスト全体の500失敗にしていたが、これは
  // 「設定不備時は診断自体を止める」という可用性優先の設計だった。今回、公開診断APIは
  // 設定不備時も診断自体は継続し、canonical計測だけを「未測定」として扱う
  // fail-closed(データの正確性優先)へ変更する。
  // - 未設定・不正値・API key/model欠落: canonical無効(aiMeasurementProvider=undefined)
  //   として診断を続行し、秘密情報を含まない警告のみサーバーログへ出す。
  // - AI_MEASUREMENT_PROVIDER="mock": 公開診断APIではcanonicalの「mock」モードを
  //   実測として使わない。createAiMeasurementProviderFromConfig()はmock指定時
  //   undefinedを返す実装だが(canonical mock providerクラス自体が存在しない)、
  //   ここでも明示的に警告ログを残し、意図せぬmock有効化に気づけるようにする。
  // - スコアへは今回も一切接続しない(2026-09-08承認の分離を維持、
  //   tests/unit/runFreeDiagnosisCanonicalScoringIsolation.test.ts)。
  let aiMeasurementProvider;
  try {
    const aiMeasurementConfig = resolveAiMeasurementConfigFromProcessEnv();
    if (aiMeasurementConfig.provider === "mock") {
      console.warn(
        "[POST /api/diagnosis] AI_MEASUREMENT_PROVIDER='mock' is set; canonical measurement " +
          "is disabled for this request (mock is never used as canonical/live data on the " +
          "public diagnosis API)."
      );
    }
    aiMeasurementProvider = createAiMeasurementProviderFromConfig(aiMeasurementConfig);
  } catch (err) {
    if (err instanceof AiMeasurementConfigError) {
      console.warn(
        "[POST /api/diagnosis] AI measurement config error, continuing with canonical " +
          "measurement disabled (not falling back to mock):",
        err.message
      );
      aiMeasurementProvider = undefined;
    } else {
      throw err;
    }
  }

  try {
    const diagnosisInput = currentContact
      ? {
          // ログイン中は登録済みの医院情報を正本とし、bodyで別医院の情報へ
          // 差し替えることを許さない。任意URLだけは未登録時に今回の入力を利用する。
          clinicName: currentContact.clinic.name,
          directorName:
            currentContact.clinic.directorName ?? String(directorName ?? ""),
          clinicUrl: currentContact.clinic.url,
          contactEmail: currentContact.email,
          contactPhone:
            currentContact.clinic.contactPhone ?? (contactPhone ? String(contactPhone) : ""),
          gbpUrl: currentContact.clinic.gbpUrl ?? (gbpUrl ? String(gbpUrl) : undefined),
          bookingUrl:
            currentContact.clinic.bookingUrl ?? (bookingUrl ? String(bookingUrl) : undefined),
        }
      : {
          clinicName: String(clinicName ?? ""),
          directorName: String(directorName ?? ""),
          clinicUrl: String(clinicUrl ?? ""),
          contactEmail: String(contactEmail ?? ""),
          contactPhone: contactPhone ? String(contactPhone) : "",
          gbpUrl: gbpUrl ? String(gbpUrl) : undefined,
          bookingUrl: bookingUrl ? String(bookingUrl) : undefined,
        };

    const result = await runFreeDiagnosis(
      diagnosisInput,
      { aiProvider, competitorProvider, scoreProvider, adComplianceProvider, aiMeasurementProvider }
    );

    const saved = await saveDiagnosisResult(
      {
        clinicUrl: diagnosisInput.clinicUrl,
        directorName: diagnosisInput.directorName,
        contactEmail: diagnosisInput.contactEmail,
        contactPhone: diagnosisInput.contactPhone,
        gbpUrl: diagnosisInput.gbpUrl,
        bookingUrl: diagnosisInput.bookingUrl,
        existingClinicId: currentContact?.clinicId,
        // 2026-09-29追加(PO承認、Salesforce連携P0): 初回流入UTMの永続化。
        utm: utmFields,
      },
      result
    );

    // Ver3.3仕様(2026-09-21): 無料診断フォーム送信時点からSalesforce Leadとして
    // 管理できるようにする。Salesforce未接続(disabled)時やイベント送信失敗時も
    // 診断結果自体は保存済みのため、診断処理を失敗扱いにしない。
    await enqueueIntegrationEvent({
      eventType: "diagnosis_completed",
      clinicId: saved.clinicId,
      contactId: currentContact?.id ?? null,
      payload: {
        email: diagnosisInput.contactEmail,
        clinic_name: diagnosisInput.clinicName,
        director_name: diagnosisInput.directorName,
        website_url: diagnosisInput.clinicUrl,
        phone: diagnosisInput.contactPhone ?? null,
        // 2026-09-29追加(PO承認、Salesforce連携P0): Contact ID(将来の外部ID方式upsert用、
        // 現時点ではキューpayload/CSVにのみ残し、実送信フィールドへは追加しない)と
        // 診断メタ情報(ID・日時・総合スコア・AIO/LLMO状態)を追加する。
        contact_id: currentContact?.id ?? null,
        diagnosis_id: saved.diagnosisId,
        diagnosis_measured_at: result.measuredAt,
        total_score: result.scoreBreakdown.totalPoints,
        aio_status: result.scoreBreakdown.domains.find((d) => d.domain === "AIO")?.status ?? null,
        llmo_status: result.scoreBreakdown.domains.find((d) => d.domain === "LLMO")?.status ?? null,
        ...utmFields,
      },
    }).catch((error) => {
      console.error("[POST /api/diagnosis] Salesforce sync enqueue failed:", error);
    });

    // 診断保存後に結果メールを送る。メール基盤が未設定(disabled)なら何もせず、
    // 設定不備・provider障害でも保存済みの診断結果は失敗扱いにしない。
    // 例外にはAPI keyやprovider response bodyを含めない設計のため、ログも種類だけに留める。
    let resultEmailStatus: Exclude<ResultEmailDeliveryStatus, "pending">;
    try {
      resultEmailStatus = await sendDiagnosisResultEmail({
        to: diagnosisInput.contactEmail,
        diagnosisId: saved.diagnosisId,
        result,
      });
    } catch (emailError) {
      resultEmailStatus = "failed";
      console.error(
        "[POST /api/diagnosis] result email delivery failed:",
        emailError instanceof Error ? emailError.name : "UnknownError"
      );
    }

    try {
      await updateDiagnosisResultEmailStatus(saved.diagnosisId, resultEmailStatus);
    } catch (statusError) {
      // メール送信結果の記録失敗で、完成済みの診断結果を失敗扱いにはしない。
      // 値やprovider応答はログへ出さず、例外種別だけを残す。
      console.error(
        "[POST /api/diagnosis] result email status persistence failed:",
        statusError instanceof Error ? statusError.name : "UnknownError"
      );
    }

    // 2026-09-05のユーザー指示②: 公開JSON APIは新設せず、レスポンスはdiagnosisIdと
    // 処理状態のみに留める(診断結果本体はServer ComponentがgetDiagnosisById経由で
    // 直接DBから取得する。診断は同期的に完了しているためstatusは常に"completed")。
    return NextResponse.json(
      {
        diagnosisId: saved.diagnosisId,
        status: "completed",
        resultEmailStatus,
      },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof InvalidDiagnosisInputError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[POST /api/diagnosis] unexpected error", err);
    return NextResponse.json(
      { error: "診断処理中にエラーが発生しました。時間をおいて再度お試しください。" },
      { status: 500 }
    );
  }
}
