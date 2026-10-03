import { describe, expect, it } from "vitest";
import { isKnownProductionHost, isSmsSendAllowed } from "@/server/providers/sms/smsTestSendAllowlist";

const ALLOWED_CONTACT = "contact_test_1";
const ALLOWED_PHONE = "+819000000001";

function testEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    APP_BASE_URL: "https://test.dentshift.jp",
    SMS_TEST_ALLOWED_CONTACT_ID: ALLOWED_CONTACT,
    SMS_TEST_ALLOWED_PHONE: ALLOWED_PHONE,
    ...overrides,
  };
}

describe("isKnownProductionHost", () => {
  it("本番ドメイン(dentshift.jp/www/app)はtrue", () => {
    expect(isKnownProductionHost({ APP_BASE_URL: "https://dentshift.jp" })).toBe(true);
    expect(isKnownProductionHost({ APP_BASE_URL: "https://www.dentshift.jp" })).toBe(true);
    expect(isKnownProductionHost({ APP_BASE_URL: "https://app.dentshift.jp" })).toBe(true);
  });

  it("test.dentshift.jpや未知のホストはfalse", () => {
    expect(isKnownProductionHost({ APP_BASE_URL: "https://test.dentshift.jp" })).toBe(false);
    expect(
      isKnownProductionHost({ APP_BASE_URL: "https://dent-shift-test-git-foo.vercel.app" })
    ).toBe(false);
  });

  it("APP_BASE_URL未設定・不正な値は本番と断定せずfalse", () => {
    expect(isKnownProductionHost({})).toBe(false);
    expect(isKnownProductionHost({ APP_BASE_URL: "not a url" })).toBe(false);
  });
});

describe("isSmsSendAllowed", () => {
  it("本番ドメインでは許可リストの状態にかかわらず常に許可する(本番の既存動作を変えない)", () => {
    expect(
      isSmsSendAllowed(
        { contactId: "anyone", phoneNumberE164: "+819999999999" },
        { APP_BASE_URL: "https://dentshift.jp" }
      )
    ).toBe(true);
    expect(
      isSmsSendAllowed(
        { contactId: "anyone", phoneNumberE164: "+819999999999" },
        { APP_BASE_URL: "https://app.dentshift.jp" }
      )
    ).toBe(true);
  });

  it("非本番環境で、許可リストが一致すれば送信を許可する", () => {
    expect(
      isSmsSendAllowed({ contactId: ALLOWED_CONTACT, phoneNumberE164: ALLOWED_PHONE }, testEnv())
    ).toBe(true);
  });

  it("非本番環境で、許可設定が未設定(欠落)なら拒否する(設定漏れを送信許可にしない)", () => {
    expect(
      isSmsSendAllowed(
        { contactId: ALLOWED_CONTACT, phoneNumberE164: ALLOWED_PHONE },
        testEnv({ SMS_TEST_ALLOWED_CONTACT_ID: undefined, SMS_TEST_ALLOWED_PHONE: undefined })
      )
    ).toBe(false);
  });

  it("APP_BASE_URL自体が未設定の場合、本番と断定せず非本番扱いになる(許可リスト未設定なら拒否)", () => {
    expect(
      isSmsSendAllowed(
        { contactId: ALLOWED_CONTACT, phoneNumberE164: ALLOWED_PHONE },
        {}
      )
    ).toBe(false);
  });

  it("APP_BASE_URL自体が未設定でも、許可リストが一致すれば(非本番扱いとして)許可する", () => {
    expect(
      isSmsSendAllowed(
        { contactId: ALLOWED_CONTACT, phoneNumberE164: ALLOWED_PHONE },
        { SMS_TEST_ALLOWED_CONTACT_ID: ALLOWED_CONTACT, SMS_TEST_ALLOWED_PHONE: ALLOWED_PHONE }
      )
    ).toBe(true);
  });

  it("許可設定の電話番号が不正な形式(E.164でない)なら拒否する", () => {
    expect(
      isSmsSendAllowed(
        { contactId: ALLOWED_CONTACT, phoneNumberE164: "090-0000-0001" },
        testEnv({ SMS_TEST_ALLOWED_PHONE: "090-0000-0001" })
      )
    ).toBe(false);
  });

  it("Contact IDは一致するが電話番号が不一致なら拒否する", () => {
    expect(
      isSmsSendAllowed({ contactId: ALLOWED_CONTACT, phoneNumberE164: "+819000000099" }, testEnv())
    ).toBe(false);
  });

  it("電話番号は一致するがContact IDが不一致なら拒否する", () => {
    expect(
      isSmsSendAllowed({ contactId: "contact_other", phoneNumberE164: ALLOWED_PHONE }, testEnv())
    ).toBe(false);
  });
});
