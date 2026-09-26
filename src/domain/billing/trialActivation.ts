export const TRIAL_PERIOD_DAYS = 7;

// Ver3.3仕様(2026-09-21): 7日間無料トライアルはライトプラン・スタンダードプランのみ
// 対象。プレミアムプランはトライアル対象外(即時課金)。
// Stripe Checkout側(stripeCheckoutProvider.ts)のtrial_period_days付与判定にも
// この一覧を再利用し、対象プランの定義を1箇所に保つ。
const TRIAL_ELIGIBLE_PLAN_IDS = ["light", "standard"] as const;

export function isTrialEligiblePlan(planId: string): boolean {
  return TRIAL_ELIGIBLE_PLAN_IDS.includes(planId as (typeof TRIAL_ELIGIBLE_PLAN_IDS)[number]);
}

export interface CheckoutEligibilityInput {
  phoneVerifiedAt: Date | null;
  smsVerificationExempt: boolean;
  emailVerifiedAt: Date | null;
  consentAcceptedAt: Date | null;
}

export type CheckoutEligibility =
  | { ok: true }
  | { ok: false; missing: "sms" | "email" | "consent" };

/**
 * 通常のStripe Checkout開始条件(2026-09-25)。Stripe Checkoutは作成した時点で7日間無料
 * トライアルが始まるため、SMS認証・メール確認・規約同意の3条件が揃う前にCheckoutを
 * 作らせない。UI非表示に依存せず、checkout APIがこの関数でサーバー側から必ず拒否する。
 * smsVerificationExemptは運営がContact単位で個別設定する限定例外(SMS条件のみ免除)。
 */
export function evaluateCheckoutEligibility(input: CheckoutEligibilityInput): CheckoutEligibility {
  if (!input.phoneVerifiedAt && !input.smsVerificationExempt) return { ok: false, missing: "sms" };
  if (!input.emailVerifiedAt) return { ok: false, missing: "email" };
  if (!input.consentAcceptedAt) return { ok: false, missing: "consent" };
  return { ok: true };
}

/**
 * 登録完了(registrationStep="completed")の判定。Checkout開始条件に加えて、
 * Stripe側で決済方法登録(checkout.session.completed)が完了していること。
 */
export function isRegistrationComplete(
  input: CheckoutEligibilityInput & { paymentMethodStatus: string | null }
): boolean {
  return evaluateCheckoutEligibility(input).ok && input.paymentMethodStatus === "completed";
}
