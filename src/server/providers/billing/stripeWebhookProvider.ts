import "server-only";
import Stripe from "stripe";
import { isPlanId, type PlanId } from "@/domain/billing/planCatalog";
import type {
  BillingWebhookCommand,
  BillingWebhookIdentity,
} from "@/domain/billing/billingWebhook";
import type { SubscriptionStatus } from "@/domain/billing/subscriptionStatus";
import type {
  OptionOrderWebhookCommand,
  OptionOrderWebhookIdentity,
} from "@/domain/options/optionOrderWebhook";

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

function readMetadata(value: unknown): {
  clinicId: string | null;
  plan: PlanId | null;
  inviteId: string | null;
  inviteCode: string | null;
} {
  const metadata = asRecord(value);
  const clinicId = nonEmptyString(metadata?.clinic_id);
  const planValue = nonEmptyString(metadata?.plan);
  return {
    clinicId,
    plan: planValue && isPlanId(planValue) ? planValue : null,
    inviteId: nonEmptyString(metadata?.invite_id),
    inviteCode: nonEmptyString(metadata?.invite_code),
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
    // 2026-09-22の手動E2Eで発見: payment_status(付随した支払い方法の"paid"/"unpaid")は、
    // trial_period_days付き($0請求)のCheckout Sessionでも実測で常に"paid"を返す
    // (Stripeが支払い方法の登録成功を以て"paid"と扱うため)。checkout.session.completed
    // イベント自体、決済が成功した場合にしか発火しない(失敗時はこのイベントが来ない)ため、
    // payment_statusだけでは実質ほぼ常に"active"側になってしまい、7日間トライアル
    // (ライト/スタンダード)が初日からactive扱いになるバグがあった。
    // amount_total(今回の請求額)が0かどうかで判定する方が、trial_period_daysの有無と
    // 直接対応し確実(プレミアムは即時課金のためamount_total>0)。
    const amountTotal = typeof object.amount_total === "number" ? object.amount_total : null;
    return {
      ...base,
      action: {
        kind: "checkout_completed",
        identity: checkoutIdentity,
        initialStatus: amountTotal !== null && amountTotal > 0 ? "active" : "trial",
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

function ignoredOptionOrder(event: Stripe.Event): OptionOrderWebhookCommand {
  return {
    providerEventId: event.id,
    eventType: event.type,
    occurredAt: new Date(event.created * 1000),
    action: { kind: "ignored" },
  };
}

function positiveInt(value: unknown): number | null {
  const text = nonEmptyString(value);
  if (!text) return null;
  const parsed = Number.parseInt(text, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * 単発(one-time)オプション購入のCheckout Session完了通知を正規化する。
 * サブスクリプション用のcheckout.session.completed(normalizeStripeBillingEvent、
 * object.subscriptionを要求)とは相互排他: このSessionはmode="payment"で作成され
 * object.subscriptionを持たないため、両方のnormalizerが同じイベントを二重処理することはない。
 */
export function normalizeStripeOneTimePurchaseEvent(
  event: Stripe.Event
): OptionOrderWebhookCommand {
  const base = {
    providerEventId: event.id,
    eventType: event.type,
    occurredAt: new Date(event.created * 1000),
  };
  const object = asRecord(event.data.object);
  if (!object || Number.isNaN(base.occurredAt.getTime())) return ignoredOptionOrder(event);
  if (event.type !== "checkout.session.completed") return ignoredOptionOrder(event);

  // サブスク用Checkoutはobject.subscriptionを持つ。one-time(mode="payment")は持たない。
  if (objectId(object.subscription)) return ignoredOptionOrder(event);

  const sessionId = nonEmptyString(object.id);
  const metadata = asRecord(object.metadata);
  const clinicId = nonEmptyString(metadata?.clinic_id);
  const clientReferenceId = nonEmptyString(object.client_reference_id);
  if (!sessionId || !clinicId || clinicId !== clientReferenceId) {
    return ignoredOptionOrder(event);
  }
  if (object.payment_status !== "paid") {
    return ignoredOptionOrder(event);
  }

  const identity: OptionOrderWebhookIdentity = {
    stripeCheckoutSessionId: sessionId,
    clinicId,
    reportId: nonEmptyString(metadata?.report_id),
    version: positiveInt(metadata?.version),
    optionProductKey: nonEmptyString(metadata?.option_product_key),
    improvementActionKey: nonEmptyString(metadata?.improvement_action_id),
  };

  return {
    ...base,
    action: {
      kind: "one_time_paid",
      identity,
      stripePaymentIntentId: objectId(object.payment_intent),
      amountTotalJpy: typeof object.amount_total === "number" ? object.amount_total : null,
    },
  };
}
