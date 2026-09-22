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
    }
  | {
      kind: "invoice_status";
      identity: BillingWebhookIdentity;
      status: "active" | "past_due";
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
