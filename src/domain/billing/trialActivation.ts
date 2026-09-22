export const TRIAL_PERIOD_DAYS = 7;
const TRIAL_PERIOD_MS = 1000 * 60 * 60 * 24 * TRIAL_PERIOD_DAYS;

// Ver3.3仕様(2026-09-21): 7日間無料トライアルはライトプラン・スタンダードプランのみ
// 対象。プレミアムプランはトライアル対象外(即時課金)。
// Stripe Checkout側(stripeCheckoutProvider.ts)のtrial_period_days付与判定にも
// この一覧を再利用し、対象プランの定義を1箇所に保つ。
const TRIAL_ELIGIBLE_PLAN_IDS = ["light", "standard"] as const;

export function isTrialEligiblePlan(planId: string): boolean {
  return TRIAL_ELIGIBLE_PLAN_IDS.includes(planId as (typeof TRIAL_ELIGIBLE_PLAN_IDS)[number]);
}

export interface TrialActivationGateInput {
  planId: string;
  phoneVerifiedAt: Date | null;
  emailVerifiedAt: Date | null;
  consentAcceptedAt: Date | null;
  paymentMethodStatus: string | null;
  trialStartedAt: Date | null;
}

/**
 * 指示書4章「SMS・メール・Stripe・規約同意がすべて成功するまでtrial_started_atを
 * 設定しない」を機械的に判定する純粋関数。既にtrial開始済みの場合はfalseを返し、
 * 二重設定を防ぐ。プレミアムプランはVer3.3仕様によりトライアル対象外。
 */
export function isEligibleForTrialActivation(input: TrialActivationGateInput): boolean {
  if (input.trialStartedAt) return false;
  if (!isTrialEligiblePlan(input.planId)) {
    return false;
  }
  return Boolean(
    input.phoneVerifiedAt &&
      input.emailVerifiedAt &&
      input.consentAcceptedAt &&
      input.paymentMethodStatus === "completed"
  );
}

export function computeTrialEndsAt(trialStartedAt: Date): Date {
  return new Date(trialStartedAt.getTime() + TRIAL_PERIOD_MS);
}
