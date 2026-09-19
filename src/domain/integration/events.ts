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
