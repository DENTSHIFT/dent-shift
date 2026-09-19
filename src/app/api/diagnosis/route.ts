import { NextRequest, NextResponse } from "next/server";
import { runFreeDiagnosis, InvalidDiagnosisInputError } from "@/server/services/runFreeDiagnosis";
import { MockAiProvider } from "@/server/providers/ai/mockAiProvider";
import { MockCompetitorProvider } from "@/server/providers/competitor/mockCompetitorProvider";
import { MockScoreProvider } from "@/server/providers/scoring/mockScoreProvider";
import { MockAdComplianceProvider } from "@/server/providers/ad-compliance/mockAdComplianceProvider";
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

// legacy mock providers(P0案Bの「既存mock/reference score用」経路。2026-09-08の
// ユーザー指示: AI_MEASUREMENT_PROVIDER="openai"でもこのlegacy aiProviderは
// 消さない。canonical aiMeasurementProvider(下記)はあくまでOpenAI実測overlayで
// あり、legacy mock診断を置き換えるものではない)。
const aiProvider = new MockAiProvider();
const competitorProvider = new MockCompetitorProvider();
const scoreProvider = new MockScoreProvider();
const adComplianceProvider = new MockAdComplianceProvider();

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "リクエストボディがJSONとして解釈できません" }, { status: 400 });
  }

  const {
    clinicName,
    clinicUrl,
    contactEmail,
    contactPhone,
    gbpUrl,
    bookingUrl,
    allowDuplicateClinic,
  } =
    (body ?? {}) as Record<string, unknown>;

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

  // canonical AI計測provider(OpenAI実測overlay)のcomposition(2026-09-08の
  // ユーザー指示: Phase 3、composition root接続)。
  //
  // 【重要】ここでのconfig解決・provider構築はrequestごとに行う(module load時では
  // ない)。AI_MEASUREMENT_PROVIDER未設定・不正値・(openai選択時の)API key/model
  // 欠落は、mockへのsilent fallbackにはせず、この request自体を明示的にerror
  // response(500)として終わらせる。API key文字列そのものはレスポンス・ログの
  // いずれにも出さない(AiMeasurementConfigErrorのmessageは元々key値を含まない
  // 設計だが、念のためログ出力もmessageのみに限定する)。
  let aiMeasurementProvider;
  try {
    const aiMeasurementConfig = resolveAiMeasurementConfigFromProcessEnv();
    aiMeasurementProvider = createAiMeasurementProviderFromConfig(aiMeasurementConfig);
  } catch (err) {
    if (err instanceof AiMeasurementConfigError) {
      console.error("[POST /api/diagnosis] AI measurement config error:", err.message);
      return NextResponse.json(
        { error: "AI計測providerの設定が不正です。管理者にお問い合わせください。" },
        { status: 500 }
      );
    }
    throw err;
  }

  try {
    const diagnosisInput = currentContact
      ? {
          // ログイン中は登録済みの医院情報を正本とし、bodyで別医院の情報へ
          // 差し替えることを許さない。任意URLだけは未登録時に今回の入力を利用する。
          clinicName: currentContact.clinic.name,
          clinicUrl: currentContact.clinic.url,
          contactEmail: currentContact.email,
          contactPhone:
            currentContact.clinic.contactPhone ?? String(contactPhone ?? ""),
          gbpUrl: currentContact.clinic.gbpUrl ?? (gbpUrl ? String(gbpUrl) : undefined),
          bookingUrl:
            currentContact.clinic.bookingUrl ?? (bookingUrl ? String(bookingUrl) : undefined),
        }
      : {
          clinicName: String(clinicName ?? ""),
          clinicUrl: String(clinicUrl ?? ""),
          contactEmail: String(contactEmail ?? ""),
          contactPhone: String(contactPhone ?? ""),
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
        contactEmail: diagnosisInput.contactEmail,
        contactPhone: diagnosisInput.contactPhone,
        gbpUrl: diagnosisInput.gbpUrl,
        bookingUrl: diagnosisInput.bookingUrl,
        existingClinicId: currentContact?.clinicId,
      },
      result
    );

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
