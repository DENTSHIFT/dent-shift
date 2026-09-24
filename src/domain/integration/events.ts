// 指示書10章「Salesforceイベント」の最低限同期対象イベント名。
// イベント名は指示書の記載どおり英語スネークケースで固定する。
export const INTEGRATION_EVENT_TYPES = [
  "diagnosis_started",
  "diagnosis_completed",
  "diagnosis_result_viewed",
  "trial_signup_started",
  "phone_added",
  "sms_verification_sent",
  "phone_verified",
  "email_verification_sent",
  "email_verified",
  "payment_method_completed",
  "trial_started",
  "online_consultation_clicked",
  "online_consultation_booked",
  "online_consultation_completed",
  "phone_inquiry_clicked",
  "subscription_activated",
  "subscription_canceled",
  "trial_expired_without_conversion",
] as const;

export type IntegrationEventType = (typeof INTEGRATION_EVENT_TYPES)[number];

export function isIntegrationEventType(value: string): value is IntegrationEventType {
  return (INTEGRATION_EVENT_TYPES as readonly string[]).includes(value);
}

// 指示書8章「Salesforceへ送ってはいけないもの」に対応する禁止キー名。
// payload組み立て時にこのリストに含まれるキーがあれば必ず除外する(ホワイトリスト方式の
// 最終防衛線)。
const FORBIDDEN_PAYLOAD_KEYS = [
  "otp",
  "code",
  "password",
  "passwordhash",
  "password_hash",
  "token",
  "sessiontoken",
  "session_token",
  "secret",
  "cardnumber",
  "card_number",
  "cvc",
] as const;

/**
 * Salesforce送信禁止項目が誤って含まれていないかを機械的に検証する純粋関数。
 * キー名の大文字小文字・区切り文字違いを問わず部分一致で検出する。
 */
export function assertNoForbiddenPayloadKeys(payload: Record<string, unknown>): void {
  for (const key of Object.keys(payload)) {
    const normalized = key.toLowerCase().replace(/[_-]/g, "");
    if (FORBIDDEN_PAYLOAD_KEYS.some((forbidden) => normalized.includes(forbidden.replace(/[_-]/g, "")))) {
      throw new Error(`Payload key "${key}" must not be sent to Salesforce.`);
    }
  }
}

// opsの再送管理画面向け。個人情報らしきキー(メール・電話・氏名)の値を画面表示前に
// マスクする(2026-09-24、opsからの個人情報無条件表示を避けるための最終防衛線)。
// キー自体(項目名)は残し、値のみ伏せることで、どのデータが保存されているかは
// 運営者が把握しつつ、値そのものは露出しない。
const PII_LIKE_PAYLOAD_KEY_PATTERN = /email|phone|tel|name|address/i;

export function redactIntegrationEventPayloadForOps(
  payload: Record<string, unknown>
): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (PII_LIKE_PAYLOAD_KEY_PATTERN.test(key) && typeof value === "string" && value.length > 0) {
      redacted[key] = "•••(マスク済み)";
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}
