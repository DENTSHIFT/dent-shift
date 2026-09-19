import { describe, expect, it } from "vitest";
import { assertNoForbiddenPayloadKeys, isIntegrationEventType } from "@/domain/integration/events";

describe("isIntegrationEventType", () => {
  it("指示書10章の既知イベント名を許可する", () => {
    expect(isIntegrationEventType("trial_started")).toBe(true);
    expect(isIntegrationEventType("phone_verified")).toBe(true);
  });

  it("未知のイベント名を拒否する", () => {
    expect(isIntegrationEventType("unknown_event")).toBe(false);
  });
});

describe("assertNoForbiddenPayloadKeys", () => {
  it("許可されたキーのみのpayloadは例外を投げない", () => {
    expect(() =>
      assertNoForbiddenPayloadKeys({ email: "a@example.com", clinic_name: "テスト歯科" })
    ).not.toThrow();
  });

  it.each([
    ["otp"],
    ["otp_code"],
    ["password_hash"],
    ["session_token"],
    ["card_number"],
    ["cvc"],
    ["stripe_secret"],
  ])("Salesforce送信禁止キー「%s」を検出して例外を投げる", (forbiddenKey) => {
    expect(() => assertNoForbiddenPayloadKeys({ [forbiddenKey]: "value" })).toThrow();
  });
});
