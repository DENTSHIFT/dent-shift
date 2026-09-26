export const PASSWORD_RESET_EMAIL_MIN_INTERVAL_MS = 60_000;
export const PASSWORD_RESET_SMS_MIN_INTERVAL_MS = 60_000;
export const PASSWORD_RESET_SMS_WINDOW_MS = 60 * 60_000;
export const PASSWORD_RESET_SMS_MAX_SENDS_PER_WINDOW = 5;
export const PASSWORD_RESET_SMS_MAX_ATTEMPTS = 5;
export const PASSWORD_RESET_SMS_CODE_VALID_MS = 10 * 60_000;

export const PASSWORD_RESET_EMAIL_GENERIC_MESSAGE =
  "入力されたメールアドレスに該当するアカウントがある場合、パスワード再設定用のメールを送信します。";
export const PASSWORD_RESET_SMS_GENERIC_MESSAGE =
  "入力されたメールアドレスに該当するアカウントでSMS再設定が利用可能な場合、登録済みの携帯電話番号へ認証コードを送信します。";
export const PASSWORD_RESET_SMS_INVALID_CODE_MESSAGE =
  "認証コードが正しくないか、有効期限が切れています。もう一度お試しください。";

export interface SmsResetContactState {
  phoneNumber: string | null;
  phoneVerifiedAt: Date | null;
  passwordResetSmsSentAt: Date | null;
  passwordResetSmsWindowStartedAt: Date | null;
  passwordResetSmsSendCount: number;
  passwordResetSmsAttemptCount: number;
}

// smsVerificationExempt(SMS認証免除)は「SMS認証済み」とみなさない。
// 登録済みかつ認証済みの電話番号を持つContactだけがSMS再設定の対象。
export function isSmsResetEligible(contact: Pick<SmsResetContactState, "phoneNumber" | "phoneVerifiedAt">): boolean {
  return Boolean(contact.phoneNumber) && contact.phoneVerifiedAt !== null;
}

export type SmsSendDecision =
  | { allowed: true; sendCount: number; windowStartedAt: Date }
  | { allowed: false };

export function decideSmsSend(contact: SmsResetContactState, now: Date): SmsSendDecision {
  if (!isSmsResetEligible(contact)) return { allowed: false };
  if (
    contact.passwordResetSmsSentAt &&
    now.getTime() - contact.passwordResetSmsSentAt.getTime() < PASSWORD_RESET_SMS_MIN_INTERVAL_MS
  ) {
    return { allowed: false };
  }
  const windowActive =
    contact.passwordResetSmsWindowStartedAt !== null &&
    now.getTime() - contact.passwordResetSmsWindowStartedAt.getTime() < PASSWORD_RESET_SMS_WINDOW_MS;
  const sendCount = windowActive ? contact.passwordResetSmsSendCount : 0;
  if (sendCount >= PASSWORD_RESET_SMS_MAX_SENDS_PER_WINDOW) return { allowed: false };
  return {
    allowed: true,
    sendCount: sendCount + 1,
    windowStartedAt: windowActive && contact.passwordResetSmsWindowStartedAt ? contact.passwordResetSmsWindowStartedAt : now,
  };
}

export function canCheckSmsCode(contact: SmsResetContactState, now: Date): boolean {
  if (!isSmsResetEligible(contact)) return false;
  if (!contact.passwordResetSmsSentAt) return false;
  if (now.getTime() - contact.passwordResetSmsSentAt.getTime() > PASSWORD_RESET_SMS_CODE_VALID_MS) return false;
  return contact.passwordResetSmsAttemptCount < PASSWORD_RESET_SMS_MAX_ATTEMPTS;
}
