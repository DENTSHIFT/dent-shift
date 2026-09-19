import "server-only";

export interface DisabledSmsConfig {
  provider: "disabled";
}

export interface TwilioVerifySmsConfig {
  provider: "twilio-verify";
  accountSid: string;
  authToken: string;
  verifyServiceSid: string;
}

export type SmsConfig = DisabledSmsConfig | TwilioVerifySmsConfig;

export class SmsConfigError extends Error {}

/**
 * SMS基盤(IVRy OTP APIの可否)は未確定のため既定値をdisabledとし、
 * Twilio Verifyを仮実装として明示選択した場合だけ必須設定を検証する(指示書5章・23章)。
 */
export function resolveSmsConfig(options: {
  env: Record<string, string | undefined>;
}): SmsConfig {
  const rawProvider = options.env.SMS_PROVIDER?.trim() || "disabled";
  if (rawProvider === "disabled") return { provider: "disabled" };
  if (rawProvider !== "twilio-verify") {
    throw new SmsConfigError("SMS_PROVIDER must be exactly 'disabled' or 'twilio-verify'.");
  }

  const accountSid = options.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = options.env.TWILIO_AUTH_TOKEN?.trim();
  const verifyServiceSid = options.env.TWILIO_VERIFY_SERVICE_SID?.trim();

  if (!accountSid) {
    throw new SmsConfigError("SMS_PROVIDER='twilio-verify' requires TWILIO_ACCOUNT_SID.");
  }
  if (!authToken) {
    throw new SmsConfigError("SMS_PROVIDER='twilio-verify' requires TWILIO_AUTH_TOKEN.");
  }
  if (!verifyServiceSid) {
    throw new SmsConfigError("SMS_PROVIDER='twilio-verify' requires TWILIO_VERIFY_SERVICE_SID.");
  }

  return { provider: "twilio-verify", accountSid, authToken, verifyServiceSid };
}

export function resolveSmsConfigFromProcessEnv(): SmsConfig {
  return resolveSmsConfig({ env: process.env });
}
