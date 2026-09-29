import { NextRequest, NextResponse } from "next/server";
import { runFreeDiagnosis, InvalidDiagnosisInputError } from "@/server/services/runFreeDiagnosis";
import { UnavailableAiProvider } from "@/server/providers/ai/unavailableAiProvider";
import { UnavailableCompetitorProvider } from "@/server/providers/competitor/unavailableCompetitorProvider";
import { UnavailableScoreProvider } from "@/server/providers/scoring/unavailableScoreProvider";
import { UnavailableAdComplianceProvider } from "@/server/providers/ad-compliance/unavailableAdComplianceProvider";
import {
  saveDiagnosisResultIfIdempotencyLockCurrent,
  DiagnosisIdempotencyLockSupersededError,
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
import { attemptIntegrationEventSync } from "@/server/db/integrationEventRepository";
import { sanitizeUtmAttribution } from "@/domain/marketing/utmAttribution";
import { extractClientIp, hashClientIp } from "@/server/net/clientIp";
import { resolveDiagnosisRateLimitConfigFromProcessEnv } from "@/server/config/diagnosisRateLimitConfig";
import {
  reserveDiagnosisSlot,
  releaseDiagnosisSlot,
  type ReserveScopeInput,
} from "@/server/db/diagnosisRateLimitRepository";
import {
  acquireDiagnosisIdempotencyLock,
  markDiagnosisIdempotencyLockFailed,
} from "@/server/db/diagnosisIdempotencyRepository";
import { computeDiagnosisRequestFingerprint } from "@/domain/diagnosis/requestFingerprint";
import { getOrCreateAnonymousDiagnosisSessionId } from "@/server/auth/anonymousDiagnosisSession";

const CLIENT_REQUEST_ID_RE = /^[A-Za-z0-9_-]{8,100}$/;

/**
 * 2026-09-29追加(PO指摘: 実行中ロックTTLの根拠は実測時間ではなく「デプロイの設定
 * 上限」と「処理の終了条件」で確認すること)。
 *
 * このFunctionの実行時間上限をVercelのプラン既定値(実測でしか確認できない、環境
 * 依存の値)に委ねず、コード上で明示的に設定する。これにより「デプロイの設定上限」
 * 自体がこのファイルを読むだけで確認できる値になる(Vercel Runtime Logsを見比べる
 * 必要がない)。
 *
 * 「処理の終了条件」側の根拠は、canonical AI計測(OpenAI呼び出し)自体が
 * timeoutMs=15000×maxAttempts=2 + backoff ≈ 30.5秒でworst caseが打ち切られるよう
 * 設計されている(src/server/config/aiMeasurementConfig.tsのDEFAULT_OPENAI_TIMEOUT_MS/
 * DEFAULT_OPENAI_MAX_ATTEMPTS、質問間はPromise.allで並列実行のため直列に積み上がら
 * ない)こと。診断保存(DB書き込み)・結果メール送信・Salesforce同期enqueueは
 * いずれも診断結果自体を失敗扱いにしないtry/catchで包まれているが、ネットワーク呼び
 * 出し自体に個別のtimeoutは未設定の箇所もあるため(saveDiagnosisResultのDB書き込み)、
 * それらが極端に遅延した場合の最終的な上限はこのFunction自体のmaxDuration(下記)が
 * 打ち切り条件として働く。
 *
 * 【PO指摘(2回目)への対応: 60秒制限はAI呼び出し以外の全処理が対象】
 * 実際にこのRoute Handlerが行う処理はAI呼び出しだけではない(Salesforce同期・
 * 結果メール送信も診断保存後に同期的にawaitされる)。worst caseの内訳と根拠の
 * 全文はsrc/server/config/diagnosisFunctionDuration.tsのコメントを参照
 * (AI計測≈30.5秒+Salesforce同期≈30秒+メール送信≈10秒 = 合計≈70.5秒)。
 *
 * 値(秒)はNext.jsのRoute Segment Config規約上、この場でリテラルとして書く必要が
 * ある(importした変数を使うと静的解析に失敗する)。実行中ロックTTL
 * (DIAGNOSIS_INFLIGHT_LOCK_TTL_MS)側は同じ根拠の値を
 * src/server/config/diagnosisFunctionDuration.tsのDIAGNOSIS_FUNCTION_MAX_DURATION_MS
 * (=90秒)として定数化してあるため、この90という値を変更する場合は両方を合わせて
 * 変更すること。
 */
export const maxDuration = 90;

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
    clientRequestId,
  } =
    (body ?? {}) as Record<string, unknown>;

  // 2026-09-29追加(PO承認、再診断ループの連続実行対策P0): タイムアウト後の再送・
  // 二重クリックによる同一論理リクエストの多重送信を検知するための、クライアント
  // 発行の冪等性キー。診断フォーム(1回の送信操作)ごとに1つ発行される想定で、
  // 外部AI呼び出しより前に判定する(このキーが無ければ409で拒否し、AIへ進まない)。
  if (typeof clientRequestId !== "string" || !CLIENT_REQUEST_ID_RE.test(clientRequestId)) {
    return NextResponse.json({ error: "リクエストの形式が正しくありません" }, { status: 400 });
  }

  // 2026-09-24: Instagram等の流入チャネル別に診断「開始」と「完了」を比較するためのUTM値
  // (5項目)。diagnosis_started(開始)と同じsanitizeUtmAttribution()を使い、
  // 同じ入力からは常に同じ形の値を出す(未指定時はnull=直接流入・既存LP経由など)。
  const utmFields = sanitizeUtmAttribution((body ?? {}) as Record<string, unknown>);

  if (allowDuplicateClinic !== undefined && typeof allowDuplicateClinic !== "boolean") {
    return NextResponse.json({ error: "重複確認の値が不正です" }, { status: 400 });
  }

  // 2026-09-29修正(PO指摘、冪等性キーの主体紐付けP0): principalKey/inputHashの計算に
  // currentContactが必要なため、冪等性チェックより前にセッションを解決する。
  const currentContact = await getCurrentContact();
  const clientIpForPrincipal = hashClientIp(extractClientIp(request.headers));
  // 2026-09-29修正(PO指摘): 未ログイン利用者の主体識別をIPハッシュ単独から、
  // ブラウザ単位の匿名セッションcookieへ変更する(同じ院内回線の複数利用者を
  // 誤って同一主体として扱わないため)。IPハッシュ自体はレート制限のスコープ
  // (scopeType: "ip")としては引き続き使う(そちらは「回線単位の抑制」が目的であり
  // 本人識別ではないため、この変更の対象外)。
  const principalKey = currentContact
    ? `contact:${currentContact.id}`
    : `anon:${await getOrCreateAnonymousDiagnosisSessionId()}`;
  const inputHash = computeDiagnosisRequestFingerprint({
    clinicName,
    directorName,
    clinicUrl,
    contactEmail,
    contactPhone,
    gbpUrl,
    bookingUrl,
  });

  let idempotency;
  try {
    idempotency = await acquireDiagnosisIdempotencyLock(clientRequestId, principalKey, inputHash);
  } catch (err) {
    console.error("[POST /api/diagnosis] idempotency check error", err);
    return NextResponse.json(
      { error: "診断処理中にエラーが発生しました。時間をおいて再度お試しください。" },
      { status: 503 }
    );
  }
  if (idempotency.kind === "completed") {
    // 同じclientRequestIdでの再送(タイムアウト後の再送等)。既に完了済みのため、
    // 外部AIを再実行せず同じ結果をそのまま返す。
    return NextResponse.json(
      { diagnosisId: idempotency.diagnosisId, status: "completed" },
      { status: 201 }
    );
  }
  if (idempotency.kind === "in_progress") {
    return NextResponse.json(
      { error: "同じ診断を処理中です。しばらくお待ちください。", code: "duplicate_request_in_progress" },
      { status: 409 }
    );
  }
  if (idempotency.kind === "principal_mismatch") {
    // 2026-09-29追加(PO指摘): 別の主体(別アカウント・別匿名IP)が同じ
    // clientRequestIdを使おうとした。診断結果の有無や内容を一切示唆しない、
    // 汎用的な拒否レスポンスとする。
    return NextResponse.json(
      { error: "リクエストを処理できませんでした。もう一度お試しください。", code: "request_id_conflict" },
      { status: 409 }
    );
  }
  if (idempotency.kind === "input_mismatch") {
    // 2026-09-29追加(PO指摘): 同じclientRequestIdで初回と異なる入力が送られた。
    // 冪等性キーは「同じリクエストの再送」のみを意味するため拒否する。
    return NextResponse.json(
      {
        error: "リクエスト内容が変更されています。ページを再読み込みして再度お試しください。",
        code: "request_input_mismatch",
      },
      { status: 409 }
    );
  }
  const executionId = idempotency.executionId;

  // 重複候補を確認し、重複時は外部AI計測を開始しない。
  // 候補IDは公開せず、既存Clinicへ自動統合もしない。
  try {
    if (!currentContact && allowDuplicateClinic !== true) {
      const candidate = await findClinicDuplicateCandidate({
        clinicName: String(clinicName ?? "").trim(),
        clinicUrl: String(clinicUrl ?? "").trim(),
      });
      if (candidate) {
        await markDiagnosisIdempotencyLockFailed(clientRequestId, executionId);
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
    await markDiagnosisIdempotencyLockFailed(clientRequestId, executionId);
    return NextResponse.json(
      { error: "医院情報の確認中にエラーが発生しました。時間をおいて再度お試しください。" },
      { status: 500 }
    );
  }

  // 2026-09-29追加(PO承認、再診断ループの連続実行対策P0): 外部AI呼び出しの直前に
  // IP/Clinic/Contactの3スコープでレート制限を判定する。DBによる判定自体が失敗した
  // 場合(check_failed)もAI呼び出しへは一切進まない(fail-closed)。
  const rateLimitConfig = resolveDiagnosisRateLimitConfigFromProcessEnv();
  const clientIp = clientIpForPrincipal;
  const scopes: ReserveScopeInput[] = [
    // 2026-09-29修正: IPスコープは同時実行ロック(enforceInFlightLock)の対象にしない。
    // 院内共有回線等、同じIPから複数の正当な同時アクセスが起こりうるため、回数制限
    // (windowMs/maxRequests)だけで抑制し、単一実行ロックはClinic/Contactスコープ
    // (同一アカウントの二重クリック・多重タブ対策)にのみ適用する。
    { scopeType: "ip", scopeKey: clientIp, ...rateLimitConfig.ip, enforceInFlightLock: false },
  ];
  if (currentContact) {
    // Clinic IDはクライアント入力ではなく、認証済みセッションから解決した
    // currentContact.clinicIdのみを使う(他院への影響を防ぐ、既存のsaveDiagnosisResult
    // 呼び出しと同じ原則)。
    scopes.push({
      scopeType: "clinic",
      scopeKey: currentContact.clinicId,
      ...rateLimitConfig.clinic,
      enforceInFlightLock: true,
    });
    scopes.push({
      scopeType: "contact",
      scopeKey: currentContact.id,
      ...rateLimitConfig.contact,
      enforceInFlightLock: true,
    });
  }

  const reservation = await reserveDiagnosisSlot(scopes);
  if (!reservation.allowed) {
    await markDiagnosisIdempotencyLockFailed(clientRequestId, executionId);
    if (reservation.reason === "check_failed") {
      return NextResponse.json(
        { error: "診断処理中にエラーが発生しました。時間をおいて再度お試しください。" },
        { status: 503 }
      );
    }
    const retryAt = reservation.retryAt.toISOString();
    return NextResponse.json(
      {
        error:
          reservation.reason === "in_flight"
            ? "この医院の診断を処理中です。完了後に再度お試しください。"
            : "短時間に多くの診断リクエストがありました。時間をおいて再度お試しください。",
        code: reservation.reason,
        retryAt,
        retryAfterSeconds: Math.max(0, Math.ceil((reservation.retryAt.getTime() - Date.now()) / 1000)),
      },
      { status: 429, headers: { "Retry-After": retryAt } }
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

    // 2026-09-29追加(PO指摘、重複診断保存対策P0、2回目): 実行権の確認(claim)・
    // Clinic/Diagnosis保存・冪等性ロックの完了記録を、1つのDBトランザクションとして
    // 原子的に確定させる(「確認してから保存する」という2段階方式では、確認と保存の
    // 間に別の実行が実行権を取得する窓=TOCTOUが残るため、2026-09-29最初の修正から
    // さらに強化した)。
    //
    // この呼び出しをSalesforce同期・結果メール送信より「前」に置いているのも
    // PO指摘への対応: 診断結果(Diagnosisレコード)と冪等性ロックの完了記録を先に
    // DBへ確定させることで、この後のSalesforce同期・メール送信がハングしたり
    // Functionが強制終了しても、同じclientRequestIdでの再送は必ず「completed」
    // (既存のdiagnosisIdをそのまま返す)経路に入り、AI呼び出し・DB保存を再実行
    // しない。外部送信自体はenqueueIntegrationEvent(DB上のpendingレコード+再試行
    // 可能な同期ジョブ)とsendDiagnosisResultEmail(失敗してもresultEmailStatusへ
    // 記録するだけ)という、独立して再試行可能な処理として扱う。
    let saved: Awaited<ReturnType<typeof saveDiagnosisResultIfIdempotencyLockCurrent>>;
    try {
      saved = await saveDiagnosisResultIfIdempotencyLockCurrent(
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
        result,
        { clientRequestId, executionId },
        // 2026-09-29追加(PO指摘、3回目: 診断・冪等性完了・Salesforce送信待ちイベントを
        // 同一トランザクションで保存すること)。Ver3.3仕様(2026-09-21)どおり無料診断
        // フォーム送信時点からSalesforce Leadとして管理できるようにしつつ、この
        // pending行の作成自体をClinic/Diagnosis保存と同じトランザクションに含める
        // ことで、「診断は保存されたのに送信待ちイベントが無い」状態を作らない
        // (実際のSalesforce送信=ネットワーク呼び出しはトランザクションの外で行う。
        // 下のattemptIntegrationEventSync参照)。
        (savedInTx) => ({
          eventType: "diagnosis_completed",
          clinicId: savedInTx.clinicId,
          contactId: currentContact?.id ?? null,
          payload: {
            email: diagnosisInput.contactEmail,
            clinic_name: diagnosisInput.clinicName,
            director_name: diagnosisInput.directorName,
            website_url: diagnosisInput.clinicUrl,
            phone: diagnosisInput.contactPhone ?? null,
            // 2026-09-29追加(PO承認、Salesforce連携P0): Contact ID(将来の外部ID方式
            // upsert用、現時点ではキューpayload/CSVにのみ残し、実送信フィールドへは
            // 追加しない)と診断メタ情報(ID・日時・総合スコア・AIO/LLMO状態)を追加する。
            contact_id: currentContact?.id ?? null,
            diagnosis_id: savedInTx.diagnosisId,
            diagnosis_measured_at: result.measuredAt,
            total_score: result.scoreBreakdown.totalPoints,
            aio_status: result.scoreBreakdown.domains.find((d) => d.domain === "AIO")?.status ?? null,
            llmo_status: result.scoreBreakdown.domains.find((d) => d.domain === "LLMO")?.status ?? null,
            // 2026-09-29修正(PO指摘、再診断ループP0): 今回のリクエストで送られてきた
            // 生のutmFieldsではなく、同じトランザクション内でsavedInTxが実際にDBへ
            // 確定させたUTM(persistedUtm)を使う。再診断で既に初回UTMが設定済みの
            // 医院に別のUTMを付けて送っても、確定していない値をSalesforceへ
            // 報告しないようにする。
            ...savedInTx.persistedUtm,
          },
        })
      );
    } catch (err) {
      if (err instanceof DiagnosisIdempotencyLockSupersededError) {
        return NextResponse.json(
          {
            error: "処理に時間がかかったため、別のリクエストとして扱われました。もう一度お試しください。",
            code: "execution_superseded",
          },
          { status: 409 }
        );
      }
      throw err;
    }

    // トランザクション確定後、実際のSalesforce同期(ネットワーク呼び出し)を1回だけ
    // 試行する。失敗してもpendingのままDBに残り、既存の再試行ジョブ
    // (/api/internal/salesforce/retry)が処理するため、診断処理自体は失敗扱いにしない。
    if (saved.integrationEventId) {
      await attemptIntegrationEventSync(saved.integrationEventId);
    }

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

    // 2026-09-29修正(PO指摘、重複診断保存対策P0、2回目): 完了記録は
    // saveDiagnosisResultIfIdempotencyLockCurrent()内のトランザクションで既に
    // 確定済みのため、ここでの追加の記録は不要(むしろ、ここで再度markする経路を
    // 持たないことが、「完了後にfailedへ誤って書き換えない」ことの保証になる)。

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
    await markDiagnosisIdempotencyLockFailed(clientRequestId, executionId);
    if (err instanceof InvalidDiagnosisInputError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[POST /api/diagnosis] unexpected error", err);
    return NextResponse.json(
      { error: "診断処理中にエラーが発生しました。時間をおいて再度お試しください。" },
      { status: 500 }
    );
  } finally {
    // 2026-09-29追加(PO承認、再診断ループの連続実行対策P0): 成功・失敗いずれでも、
    // 予約したスコープの実行中ロックを必ず解放する(このexecutionId発行分のみ解放)。
    await releaseDiagnosisSlot(scopes, reservation.executionId);
  }
}
