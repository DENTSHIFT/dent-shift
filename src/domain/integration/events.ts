// 指示書10章「Salesforceイベント」の最低限同期対象イベント名。
// イベント名は指示書の記載どおり英語スネークケースで固定する。
// 2026-09-27追加(PO承認、第1段階): "checkout_started"は、無料診断→トライアル導線の
// 計測要件(診断結果→プラン比較→Checkout→トライアル開始)のうち、既存基盤(この
// IntegrationEvent仕組み)で追加できる「Checkoutへ進んだ/トライアル対象プランを
// 選択した」を1イベントで表す(新しい外部分析サービスは追加していない)。
// "trial_activated"は同じ導線の最終ステップ「無料トライアルを実際に開始した」を表す。
// 既存の"trial_started"(activateTrial.ts、SMS/メール/規約同意/決済方法登録の
// 4条件がすべて揃った"registrationStep=completed"到達を根拠とし、トライアル対象外の
// プレミアム即時課金でもtrial_ends_at=nullのまま発火し得る)とは発火根拠が異なるため、
// 混同を避けて別名にした。"trial_activated"はStripeのcustomer.subscription.*Webhookで
// Subscription.statusが実際に(trial以外)→trialへ遷移した瞬間のみ発火する
// (billingRepository.ts applyBillingWebhookEventOnce()のtrialActivated判定、
// ブラウザの自己申告ではなくStripeの確定情報が根拠)。
export const INTEGRATION_EVENT_TYPES = [
  "diagnosis_started",
  "diagnosis_completed",
  "diagnosis_result_viewed",
  "diagnosis_result_trial_cta_clicked",
  // 2026-09-28追加(PO承認、P1-6): ダッシュボード上部CTA(状態に応じたトライアル/
  // プラン導線)のクリックを記録する。クリック自体はブラウザの自己申告(Webhook由来の
  // trial_activated/subscription_activatedとは区別する、PO指示)。
  "dashboard_trial_cta_clicked",
  "trial_signup_started",
  "checkout_started",
  "phone_added",
  "sms_verification_sent",
  "phone_verified",
  "email_verification_sent",
  "email_verified",
  "payment_method_completed",
  "trial_started",
  "trial_activated",
  "online_consultation_clicked",
  "online_consultation_booked",
  // TimeRexの予約キャンセル通知(event_cancelled)。予約成立(booked)とは別のイベントとして記録する。
  "online_consultation_canceled",
  "online_consultation_completed",
  "phone_inquiry_clicked",
  "subscription_activated",
  "subscription_canceled",
  // Stripe customer.subscription.*の確定イベントごとに記録する(プラン変更・解約予約・
  // 次回更新日の変化など、状態遷移を伴わない変更もSalesforce契約情報へ反映するため)。
  "subscription_updated",
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
