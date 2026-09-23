export const SUBSCRIPTION_STATUSES = [
  "trial",
  "active",
  "past_due",
  "restricted",
  "suspended",
  "cancel_scheduled",
  "cancelled",
] as const;

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

const ALLOWED_TRANSITIONS: Record<SubscriptionStatus, readonly SubscriptionStatus[]> = {
  trial: ["active", "past_due", "suspended", "cancelled"],
  active: ["past_due", "restricted", "suspended", "cancel_scheduled", "cancelled"],
  past_due: ["active", "restricted", "suspended", "cancel_scheduled", "cancelled"],
  restricted: ["active", "past_due", "suspended", "cancelled"],
  suspended: ["active", "past_due", "cancelled"],
  cancel_scheduled: ["active", "past_due", "cancelled"],
  cancelled: [],
};

export function isSubscriptionStatus(value: string): value is SubscriptionStatus {
  return SUBSCRIPTION_STATUSES.includes(value as SubscriptionStatus);
}

export function canTransitionSubscription(
  from: SubscriptionStatus,
  to: SubscriptionStatus
): boolean {
  return from === to || ALLOWED_TRANSITIONS[from].includes(to);
}

/**
 * 二重契約・二重課金防止(2026-09-23)。既存のSubscriptionがこの状態にある間は、
 * 新規Stripe Checkoutの開始をブロックする(=契約として現在も有効/係属中とみなす)。
 * "cancelled"のみ終端状態として除外し、解約済みユーザーの再契約を妨げない。
 */
export function blocksNewCheckout(status: SubscriptionStatus): boolean {
  return status !== "cancelled";
}

/**
 * checkout API・/plansページの両方から共有するガード判定。billingExempt(永久無料・
 * Pilot含む)は状態にかかわらず常にブロックする。それ以外はstatusのみで判定する
 * (Pilot由来のStripeなし契約もstatus="active"で作成されるため、statusのチェックだけで
 * 自然にカバーされる。externalSubscriptionIdのprefix等の特別扱いは不要)。
 */
export function hasExistingSubscription(subscription: {
  status: string;
  billingExempt: boolean;
} | null): boolean {
  if (!subscription) return false;
  if (subscription.billingExempt) return true;
  return isSubscriptionStatus(subscription.status) && blocksNewCheckout(subscription.status);
}
