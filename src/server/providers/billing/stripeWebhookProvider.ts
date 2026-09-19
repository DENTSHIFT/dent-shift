import "server-only";
import Stripe from "stripe";
import { isPlanId, type PlanId } from "@/domain/billing/planCatalog";
import type {
  BillingWebhookCommand,
  BillingWebhookIdentity,
} from "@/domain/billing/billingWebhook";
import type { SubscriptionStatus } from "@/domain/billing/subscriptionStatus";

export class StripeWebhookVerificationError extends Error {}

export function verifyStripeWebhookEvent(input: {
  payload: string;
  signature: string;
  apiKey: string;
  webhookSecret: string;
}): Stripe.Event {
  try {
    const stripe = new Stripe(input.apiKey);
    return stripe.webhooks.constructEvent(
      input.payload,
      input.signature,
      input.webhookSecret
    );
  } catch {
    // 署名・鍵・通知本文はログや例外メッセージへ含めない。
    throw new StripeWebhookVerificationError("Stripe webhook verification failed.");
  }
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" ? (value as UnknownRecord) : null;
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function objectId(value: unknown): string | null {
  const direct = nonEmptyString(value);
  if (direct) return direct;
  return nonEmptyString(asRecord(value)?.id);
}

function readMetadata(value: unknown): { clinicId: string | null; plan: PlanId | null } {
  const metadata = asRecord(value);
  const clinicId = nonEmptyString(metadata?.clinic_id);
  const planValue = nonEmptyString(metadata?.plan);
  return {
    clinicId,
    plan: planValue && isPlanId(planValue) ? planValue : null,
  };
}

function identity(
  externalSubscriptionId: string | null,
  metadataValue: unknown
): BillingWebhookIdentity | null {
  if (!externalSubscriptionId) return null;
  const metadata = readMetadata(metadataValue);
  return { externalSubscriptionId, ...metadata };
}

function mapStripeSubscriptionStatus(value: unknown): SubscriptionStatus | null {
  switch (value) {
    case "trialing":
      return "trial";
    case "active":
      return "active";
    case "past_due":
    case "incomplete":
      return "past_due";
    case "unpaid":
    case "paused":
      return "suspended";
    case "canceled":
    case "incomplete_expired":
      return "cancelled";
    default:
      return null;
  }
}

function ignored(event: Stripe.Event): BillingWebhookCommand {
  return {
    providerEventId: event.id,
    eventType: event.type,
    occurredAt: new Date(event.created * 1000),
    action: { kind: "ignored" },
  };
}

export function normalizeStripeBillingEvent(event: Stripe.Event): BillingWebhookCommand {
  const base = {
    providerEventId: event.id,
    eventType: event.type,
    occurredAt: new Date(event.created * 1000),
  };
  const object = asRecord(event.data.object);
  if (!object || Number.isNaN(base.occurredAt.getTime())) return ignored(event);

  if (event.type === "checkout.session.completed") {
    const checkoutIdentity = identity(objectId(object.subscription), object.metadata);
    const clientReferenceId = nonEmptyString(object.client_reference_id);
    if (
      !checkoutIdentity?.clinicId ||
      !checkoutIdentity.plan ||
      checkoutIdentity.clinicId !== clientReferenceId
    ) {
      return ignored(event);
    }
    return {
      ...base,
      action: {
        kind: "checkout_completed",
        identity: checkoutIdentity,
        initialStatus: object.payment_status === "paid" ? "active" : "trial",
      },
    };
  }

  if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    const subscriptionIdentity = identity(objectId(object), object.metadata);
    const status =
      event.type === "customer.subscription.deleted"
        ? "cancelled"
        : mapStripeSubscriptionStatus(object.status);
    if (!subscriptionIdentity || !status) return ignored(event);
    return {
      ...base,
      action: {
        kind: "subscription_status",
        identity: subscriptionIdentity,
        status,
      },
    };
  }

  if (event.type === "invoice.paid" || event.type === "invoice.payment_failed") {
    const parent = asRecord(object.parent);
    const subscriptionDetails = asRecord(parent?.subscription_details);
    const invoiceIdentity = identity(
      objectId(subscriptionDetails?.subscription),
      subscriptionDetails?.metadata
    );
    const externalPaymentId = nonEmptyString(object.id);
    if (!invoiceIdentity || !externalPaymentId) return ignored(event);
    const paid = event.type === "invoice.paid";
    return {
      ...base,
      action: {
        kind: "invoice_status",
        identity: invoiceIdentity,
        status: paid ? "active" : "past_due",
        paymentStatus: paid ? "paid" : "failed",
        externalPaymentId,
      },
    };
  }

  return ignored(event);
}
