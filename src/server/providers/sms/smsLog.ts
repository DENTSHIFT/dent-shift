import "server-only";

export type SmsLogPurpose = "phone_verify_send" | "password_reset_sms_send";

// 送信がどの環境・どのデプロイから発生したかを追跡するための構造化ログ。
// 電話番号・OTP・トークン・認証情報は一切含めない(SID・状態・エラーコードのみ)。
export function logSmsEvent(input: {
  purpose: SmsLogPurpose;
  result: "accepted" | "failed" | "skipped";
  requestSid?: string;
  providerStatus?: string;
  httpStatus?: number;
  errorCode?: number;
  reason?: string;
}): void {
  let host = "unknown";
  try {
    host = new URL(process.env.APP_BASE_URL ?? "").host || "unknown";
  } catch {
    // APP_BASE_URL未設定・不正でもログは出す。
  }
  const line = JSON.stringify({
    event: "sms_verification",
    env: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
    host,
    commit: (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7) || undefined,
    ...input,
  });
  if (input.result === "failed") console.error(line);
  else console.info(line);
}
