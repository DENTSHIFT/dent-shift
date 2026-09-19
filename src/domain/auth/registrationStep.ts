export type RegistrationStep =
  | "profile"
  | "sms"
  | "email"
  | "payment"
  | "consent"
  | "completed";

const STEP_ORDER: RegistrationStep[] = [
  "profile",
  "sms",
  "email",
  "payment",
  "consent",
  "completed",
];

/**
 * 登録ステップの前進のみを許可する(billingConfigのcanTransitionSubscriptionに倣う)。
 * 同一ステップへの再遷移は許容(冪等な再送・リトライのため)。後退は許可しない。
 */
export function canTransitionRegistrationStep(
  from: RegistrationStep,
  to: RegistrationStep
): boolean {
  const fromIndex = STEP_ORDER.indexOf(from);
  const toIndex = STEP_ORDER.indexOf(to);
  if (fromIndex === -1 || toIndex === -1) return false;
  return toIndex >= fromIndex;
}
