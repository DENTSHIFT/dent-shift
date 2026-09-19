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
