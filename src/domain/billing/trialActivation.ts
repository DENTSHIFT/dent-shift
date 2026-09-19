const TRIAL_PERIOD_MS = 1000 * 60 * 60 * 24 * 7; // 7日間

export interface TrialActivationGateInput {
  phoneVerifiedAt: Date | null;
  emailVerifiedAt: Date | null;
  consentAcceptedAt: Date | null;
  paymentMethodStatus: string | null;
  trialStartedAt: Date | null;
}

/**
 * 指示書4章「SMS・メール・Stripe・規約同意がすべて成功するまでtrial_started_atを
 * 設定しない」を機械的に判定する純粋関数。既にtrial開始済みの場合はfalseを返し、
 * 二重設定を防ぐ。
 */
export function isEligibleForTrialActivation(input: TrialActivationGateInput): boolean {
  if (input.trialStartedAt) return false;
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
