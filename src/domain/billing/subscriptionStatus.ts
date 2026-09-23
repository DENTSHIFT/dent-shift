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

/**
 * 機能制限(2026-09-24)。契約がこの状態にある間、診断・レポート等の主要機能への
 * アクセスを制限する。past_due(支払い遅延)は要お支払い確認、restricted/suspendedは
 * 利用停止、cancelledは利用不可(要再契約)として扱う。billingExemptは常に対象外、
 * cancel_scheduledは契約終了日までは通常利用可のため対象外(=ブロックしない)。
 * Subscriptionが存在しない(まだ一度も契約したことがない)場合もブロックしない
 * (登録途中の無料利用等、契約状態による制限の対象外のため)。
 */
export const FEATURE_ACCESS_BLOCKED_STATUSES: readonly SubscriptionStatus[] = [
  "past_due",
  "restricted",
  "suspended",
  "cancelled",
];

export function blocksFeatureAccess(subscription: {
  status: string;
  billingExempt: boolean;
} | null): boolean {
  if (!subscription) return false;
  if (subscription.billingExempt) return false;
  return (
    isSubscriptionStatus(subscription.status) &&
    FEATURE_ACCESS_BLOCKED_STATUSES.includes(subscription.status)
  );
}
