import "server-only";

/**
 * 2026-09-29追加(PO指摘、2回目: 60秒制限の影響はAI呼び出しだけでなく、サイト取得・
 * DB保存などを含む全処理が対象。maxDurationとロック期限の整合を確認すること)。
 *
 * /api/diagnosis Route HandlerのVercel maxDuration(デプロイの設定上限)を、
 * Runtime Logs上の実測値ではなくコード上の値として一箇所に固定する。
 * - src/app/api/diagnosis/route.tsの`export const maxDuration`はこの値を秒単位で使う。
 * - src/server/db/diagnosisRateLimitRepository.tsの実行中ロックTTLはこの値に
 *   安全マージンを足したものを使う(Functionが打ち切られた後もロックだけが
 *   残り続けないように、Functionの上限より長いTTLにする)。
 *
 * 【処理全体のworst case内訳(コード上の終了条件から積み上げ)】
 * - canonical AI計測(OpenAI呼び出し): timeoutMs×maxAttempts+backoff
 *   (src/server/config/aiMeasurementConfig.ts) ≈ 30.5秒。質問間はPromise.allで
 *   並列実行のため直列には積み上がらない。
 * - saveDiagnosisResult(DB書き込みのみ、外部ネットワーク呼び出しなし): 数秒未満
 *   (個別timeoutは無いが、外部APIを待たないため長時間化するボトルネックにはならない)。
 * - Salesforce同期(enqueueIntegrationEvent→syncIntegrationEvent、診断保存後に
 *   同期的にawaitされる): src/server/providers/salesforce/salesforceClient.tsの
 *   OAuthトークン取得→Lead検索→作成/更新の最大3回のfetchが直列に発生し、各々
 *   AbortSignal.timeout(10_000)で個別に打ち切られる。worst case ≈ 30秒。
 * - 結果メール送信(sendDiagnosisResultEmail→Resend API):
 *   src/server/providers/email/resendEmailProvider.tsもAbortSignal.timeout(10_000)。
 *   worst case ≈ 10秒。
 * 合計worst case ≈ 30.5 + 30 + 10 = 70.5秒。AI計測のtimeoutMs/maxAttempts値を
 * 見直さない限り、maxDurationを60秒のままにするとこのworst caseで強制終了しうる
 * (診断は保存済みだが、メール未送信・Salesforce未同期・冪等性ロックが
 * in_progressのまま残る)。そのため90秒とし、安全マージンを含める。
 */
export const DIAGNOSIS_FUNCTION_MAX_DURATION_MS = 90 * 1000;
