import { describe, expect, it } from "vitest";
import { isSmsSendAllowed, isSmsTestSendAllowlistEnabled } from "@/server/providers/sms/smsTestSendAllowlist";

const ALLOWED_CONTACT = "contact_test_1";
const ALLOWED_PHONE = "+819000000001";

function envWith(overrides: Record<string, string | undefined>) {
  return {
    SMS_TEST_SEND_ALLOWLIST_ENABLED: "true",
    SMS_TEST_ALLOWED_CONTACT_ID: ALLOWED_CONTACT,
    SMS_TEST_ALLOWED_PHONE: ALLOWED_PHONE,
    ...overrides,
  };
}

describe("smsTestSendAllowlist", () => {
  it("ガード未設定(SMS_TEST_SEND_ALLOWLIST_ENABLED未設定)なら常に許可する(本番の既存動作を変えない)", () => {
    expect(isSmsTestSendAllowlistEnabled({})).toBe(false);
    expect(
      isSmsSendAllowed({ contactId: "anything", phoneNumberE164: "+819999999999" }, {})
    ).toBe(true);
  });

  it("許可されたContact ID・電話番号が一致すれば許可する", () => {
    expect(
      isSmsSendAllowed(
        { contactId: ALLOWED_CONTACT, phoneNumberE164: ALLOWED_PHONE },
        envWith({})
      )
    ).toBe(true);
  });

  it("許可設定が空(未設定)なら拒否する", () => {
    expect(
      isSmsSendAllowed(
        { contactId: ALLOWED_CONTACT, phoneNumberE164: ALLOWED_PHONE },
        envWith({ SMS_TEST_ALLOWED_CONTACT_ID: undefined, SMS_TEST_ALLOWED_PHONE: undefined })
      )
    ).toBe(false);
  });

  it("許可設定の電話番号が不正な形式(E.164でない)なら拒否する", () => {
    expect(
      isSmsSendAllowed(
        { contactId: ALLOWED_CONTACT, phoneNumberE164: "090-0000-0001" },
        envWith({ SMS_TEST_ALLOWED_PHONE: "090-0000-0001" })
      )
    ).toBe(false);
  });

  it("Contact IDは一致するが電話番号が不一致なら拒否する", () => {
    expect(
      isSmsSendAllowed(
        { contactId: ALLOWED_CONTACT, phoneNumberE164: "+819000000099" },
        envWith({})
      )
    ).toBe(false);
  });

  it("電話番号は一致するがContact IDが不一致なら拒否する", () => {
    expect(
      isSmsSendAllowed(
        { contactId: "contact_other", phoneNumberE164: ALLOWED_PHONE },
        envWith({})
      )
    ).toBe(false);
  });
});
