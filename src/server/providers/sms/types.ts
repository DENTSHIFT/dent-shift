// 指示書5章「必要インターフェース例」に対応するSMS providerのadapterインターフェース。
// IVRy等への将来の差し替えを見据え、Twilio固有の型やエラーをここへ漏らさない。
export interface SendVerificationResult {
  status: "sent" | "failed";
}

export type CheckVerificationResult = "approved" | "denied" | "expired";

export interface SmsVerificationProvider {
  sendVerification(phoneNumberE164: string): Promise<SendVerificationResult>;
  checkVerification(phoneNumberE164: string, code: string): Promise<CheckVerificationResult>;
}
