import type { PlanId } from "./planCatalog";
import type { SubscriptionStatus } from "./subscriptionStatus";

export interface BillingWebhookIdentity {
  externalSubscriptionId: string;
  clinicId: string | null;
  plan: PlanId | null;
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
