import "server-only";
import { resolveResultEmailConfig } from "@/server/config/resultEmailConfig";
import { sendWithResend } from "@/server/providers/email/resendEmailProvider";

/**
 * Salesforce同期が自動再試行の上限に達した(=運用者の対応が必要な)ことを通知する。
 * 宛先はSALESFORCE_ALERT_EMAIL。顧客の個人情報・送信値は本文に含めず、イベントID・種別・
 * エラー要約(HTTPステータスとSalesforceのerrorCode)だけを載せる。
 * 通知自体の失敗は同期処理へ波及させない(ログのみ)。
 */
export async function notifySalesforceSyncFailure(input: {
  eventId: string;
  eventType: string;
  lastError: string;
}): Promise<boolean> {
  const to = process.env.SALESFORCE_ALERT_EMAIL?.trim();
  console.error(
    `[salesforceSync] retry exhausted, manual action required: event=${input.eventId} type=${input.eventType} error=${input.lastError}`
  );
  if (!to) return false;

  let config;
  try {
    config = resolveResultEmailConfig({ env: process.env });
  } catch {
    return false;
  }
  if (config.provider !== "resend") return false;

  const opsUrl = `${config.appBaseUrl}/ops/integration-events/${encodeURIComponent(input.eventId)}`;
  const text = [
    "DENT SHIFT → Salesforce の同期が自動再試行の上限に達しました。",
    "無料診断・申込の処理自体は完了しています。Salesforceへの反映のみ未完了です。",
    "",
    `イベントID: ${input.eventId}`,
    `イベント種別: ${input.eventType}`,
    `エラー: ${input.lastError}`,
    "",
    `確認・再送: ${opsUrl}`,
  ].join("\n");
  try {
    await sendWithResend({
      apiKey: config.apiKey,
      from: config.from,
      to,
      message: {
        subject: `[DENT SHIFT] Salesforce同期の要対応: ${input.eventType}`,
        text,
        html: `<pre style="font-family:monospace;white-space:pre-wrap">${escapeHtml(text)}</pre>`,
      },
    });
    return true;
  } catch (error) {
    console.error("[salesforceSync] failure alert email could not be sent:", error instanceof Error ? error.name : "UnknownError");
    return false;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
