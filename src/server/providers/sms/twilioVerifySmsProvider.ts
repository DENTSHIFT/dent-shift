import "server-only";
import type {
  CheckVerificationResult,
  SendVerificationResult,
  SmsVerificationProvider,
} from "./types";
import type { TwilioVerifySmsConfig } from "@/server/config/smsConfig";

export class SmsDeliveryError extends Error {}

/**
 * Twilio Verify REST APIをSDK不使用で直叩きする(resend/stripe providerと同じ方針)。
 * OTPコード自体はここでもDBへも保存せず、Twilio側の検証結果のみを返す。
 */
export function createTwilioVerifySmsProvider(config: TwilioVerifySmsConfig): SmsVerificationProvider {
  const authHeader = `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64")}`;
  const baseUrl = `https://verify.twilio.com/v2/Services/${config.verifyServiceSid}`;

  return {
    async sendVerification(phoneNumberE164: string): Promise<SendVerificationResult> {
      let response: Response;
      try {
        response = await fetch(`${baseUrl}/Verifications`, {
          method: "POST",
          headers: {
            Authorization: authHeader,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ To: phoneNumberE164, Channel: "sms" }).toString(),
          signal: AbortSignal.timeout(10_000),
        });
      } catch {
        throw new SmsDeliveryError("SMS provider request failed.");
      }

      if (!response.ok) {
        throw new SmsDeliveryError(`SMS provider returned HTTP ${response.status}.`);
      }
      return { status: "sent" };
    },

    async checkVerification(phoneNumberE164: string, code: string): Promise<CheckVerificationResult> {
      let response: Response;
      try {
        response = await fetch(`${baseUrl}/VerificationCheck`, {
          method: "POST",
          headers: {
            Authorization: authHeader,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ To: phoneNumberE164, Code: code }).toString(),
          signal: AbortSignal.timeout(10_000),
        });
      } catch {
        throw new SmsDeliveryError("SMS provider verification request failed.");
      }

      if (response.status === 404) return "expired";
      if (!response.ok) {
        throw new SmsDeliveryError(`SMS provider returned HTTP ${response.status}.`);
      }

      const body = (await response.json()) as { status?: string };
      return body.status === "approved" ? "approved" : "denied";
    },
  };
}
