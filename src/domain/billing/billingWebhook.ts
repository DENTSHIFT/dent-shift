import type { PlanId } from "./planCatalog";
import type { SubscriptionStatus } from "./subscriptionStatus";

export interface BillingWebhookIdentity {
  externalSubscriptionId: string;
  clinicId: string | null;
  plan: PlanId | null;
  // 2026-09-22: 知人院長向け1円招待モニター経由のcheckoutで付与される(通常契約は未設定)。
  // 通常のplan/価格ロジックには一切関与せず、Subscription.inviteId・Invite消費の
  // トレーサビリティ専用。既存の呼び出し元を壊さないようoptionalにする。
  inviteId?: string | null;
  inviteCode?: string | null;
}

export type BillingWebhookAction =
  | {
      kind: "checkout_completed";
      identity: BillingWebhookIdentity;
      initialStatus: "trial" | "active";
    }
  | {
      kind: "subscription_status";
      identity: BillingWebhookIdentity;
      status: SubscriptionStatus;
      // Stripe Subscriptionのtrial_start/trial_end(2026-09-25)。トライアルの正本はStripe。
      // トライアルが無い契約(プレミアム等)ではnull。
      trialStartedAt?: Date | null;
      trialEndsAt?: Date | null;
    }
  // 2026-09-25: invoiceイベントはPayment履歴の記録専用。契約状態(status)の正本には使わない
  // (¥0のトライアル開始invoiceでもinvoice.paidが発火し、trialing→activeへ誤上書きされていた)。
  | {
      kind: "invoice_status";
      identity: BillingWebhookIdentity;
      paymentStatus: "paid" | "failed";
      externalPaymentId: string;
    }
  | { kind: "ignored" };

export interface BillingWebhookCommand {
  providerEventId: string;
  eventType: string;
  occurredAt: Date;
  action: BillingWebhookAction;
}

export type BillingWebhookApplyResult = "processed" | "ignored" | "duplicate";

/**
 * 2026-09-23: 契約状態が実際に悪化方向へ遷移した場合のみ、呼び出し側(webhook route)へ
 * 通知メール送信のトリガーを返す。Stripe Webhookの再送(同一providerEventIdの重複)は
 * applyBillingWebhookEvent側の一意制約で"duplicate"として弾かれるため、ここに到達する
 * 時点で新規イベントであることは保証されている。さらに「更新前後でstatusが実際に
 * 変化した場合のみ」に絞ることで、同一状態を繰り返し報告するイベント(例: 複数回の
 * invoice.payment_failed)による通知の重複送信を防ぐ(冪等性の担保)。
 */
export interface BillingStatusNotification {
  clinicId: string;
  toStatus: SubscriptionStatus;
}

export interface BillingWebhookApplyOutcome {
  result: BillingWebhookApplyResult;
  notify: BillingStatusNotification | null;
}
