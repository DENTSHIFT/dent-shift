/**
 * 単発(one-time)オプション購入のCheckout Webhook通知を正規化した結果。
 * サブスクリプション用のBillingWebhookCommand(billingWebhook.ts)とは別ドメインとして
 * 分離する(責務・状態機械が異なるため)。
 */
export interface OptionOrderWebhookIdentity {
  stripeCheckoutSessionId: string;
  clinicId: string | null;
  reportId: string | null;
  version: number | null;
  optionProductKey: string | null;
  improvementActionKey: string | null;
}

export type OptionOrderWebhookAction =
  | {
      kind: "one_time_paid";
      identity: OptionOrderWebhookIdentity;
      stripePaymentIntentId: string | null;
      amountTotalJpy: number | null;
    }
  | { kind: "ignored" };

export interface OptionOrderWebhookCommand {
  providerEventId: string;
  eventType: string;
  occurredAt: Date;
  action: OptionOrderWebhookAction;
}

export type OptionOrderWebhookApplyResult =
  | "processed"
  | "ignored"
  | "duplicate"
  | "order_not_found";
