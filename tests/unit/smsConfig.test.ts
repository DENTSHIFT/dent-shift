import { describe, expect, it } from "vitest";
import { SmsConfigError, resolveSmsConfig } from "@/server/config/smsConfig";

const COMPLETE_TWILIO_ENV = {
  SMS_PROVIDER: "twilio-verify",
  TWILIO_ACCOUNT_SID: "AC_test_sid",
  TWILIO_AUTH_TOKEN: "auth_test_token",
  TWILIO_VERIFY_SERVICE_SID: "VA_test_service",
};

describe("smsConfig", () => {
  it("未設定時はSMS送信を開始できないdisabledになる", () => {
    expect(resolveSmsConfig({ env: {} })).toEqual({ provider: "disabled" });
  });

  it("twilio-verifyを明示し、必須値がある場合だけ設定を返す", () => {
    expect(resolveSmsConfig({ env: COMPLETE_TWILIO_ENV })).toEqual({
      provider: "twilio-verify",
      accountSid: "AC_test_sid",
      authToken: "auth_test_token",
      verifyServiceSid: "VA_test_service",
    });
  });

  it("不正なprovider名は明示エラーにする", () => {
    expect(() => resolveSmsConfig({ env: { SMS_PROVIDER: "other" } })).toThrow(SmsConfigError);
  });

  it.each([
    ["TWILIO_ACCOUNT_SID"],
    ["TWILIO_AUTH_TOKEN"],
    ["TWILIO_VERIFY_SERVICE_SID"],
  ])("%sなしではtwilio-verifyを有効化しない", (missingKey) => {
    const env = { ...COMPLETE_TWILIO_ENV, [missingKey]: "" };
    expect(() => resolveSmsConfig({ env })).toThrow(SmsConfigError);
  });

  it("認証トークン値を設定エラーへ含めない", () => {
    const authToken = "auth_should_never_leak";
    let caught: unknown;
    try {
      resolveSmsConfig({
        env: { ...COMPLETE_TWILIO_ENV, TWILIO_AUTH_TOKEN: authToken, TWILIO_VERIFY_SERVICE_SID: "" },
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SmsConfigError);
    expect((caught as Error).message).not.toContain(authToken);
  });
});
