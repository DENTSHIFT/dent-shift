import { describe, it, expect, vi, afterEach } from "vitest";
import {
  checkSmsConfig,
  checkBillingConfig,
  verifyStripePrice,
} from "../../scripts/verify-production-billing-sms-config.mjs";

// PO指摘(2026-09-30): 偽キー・偽Price IDでの手動テストは認証失敗(401)までしか
// 検証できず、「Price IDが存在しない(404)」経路を検証した証拠にならない。
// ここではfetchをモックし、404/200不一致/200一致の3経路を明示的に検証する。
// 値・エラー本文を出力しないことも、モックのレスポンス内容を直接検査して確認する。

describe("verifyStripePrice", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("Stripeが404(Price ID不存在)を返した場合、existsを含め全てfalseになる", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: { message: "No such price: 'price_does_not_exist'" } }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await verifyStripePrice("sk_test_dummy", "price_does_not_exist", 14_800);

    expect(result).toEqual({
      exists: false,
      amountMatches: false,
      currencyIsJpy: false,
      isMonthly: false,
      isLive: false,
    });
    // 404発生時、呼び出し先URLに渡したPrice ID以外(エラーメッセージ本文等)を
    // resultへ一切含めていないことを確認する。
    expect(Object.keys(result)).toEqual(["exists", "amountMatches", "currencyIsJpy", "isMonthly", "isLive"]);
  });

  it("Stripeが200を返すが金額/通貨/周期/livemodeが期待値と不一致な場合を検出する", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        unit_amount: 9_800, // 期待値(14,800)と不一致
        currency: "usd", // 期待(jpy)と不一致
        recurring: { interval: "year" }, // 期待(month)と不一致
        livemode: false, // 期待(true)と不一致
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await verifyStripePrice("sk_test_dummy", "price_mismatched", 14_800);

    expect(result).toEqual({
      exists: true,
      amountMatches: false,
      currencyIsJpy: false,
      isMonthly: false,
      isLive: false,
    });
  });

  it("Stripeが200を返し、金額/通貨/周期/livemodeすべて期待値と一致する場合", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        unit_amount: 14_800,
        currency: "jpy",
        recurring: { interval: "month" },
        livemode: true,
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await verifyStripePrice("sk_test_dummy", "price_matched", 14_800);

    expect(result).toEqual({
      exists: true,
      amountMatches: true,
      currencyIsJpy: true,
      isMonthly: true,
      isLive: true,
    });
  });

  it("fetch自体が例外を投げた場合(ネットワークエラー等)も、全てfalseで安全側に倒す", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network error containing sk_live_should_not_leak"))
    );

    const result = await verifyStripePrice("sk_test_dummy", "price_x", 14_800);

    expect(result).toEqual({
      exists: false,
      amountMatches: false,
      currencyIsJpy: false,
      isMonthly: false,
      isLive: false,
    });
  });
});

describe("checkSmsConfig / checkBillingConfig", () => {
  it("SMS_PROVIDERがtwilio-verify以外、または必須変数欠落ならfalseになる", () => {
    expect(checkSmsConfig({ SMS_PROVIDER: "disabled" })).toEqual({
      providerIsTwilioVerify: false,
      requiredVarsPresent: false,
    });
  });

  it("SMS_PROVIDER=twilio-verifyかつ必須変数が全て存在すればtrueになる", () => {
    expect(
      checkSmsConfig({
        SMS_PROVIDER: "twilio-verify",
        TWILIO_ACCOUNT_SID: "x",
        TWILIO_AUTH_TOKEN: "x",
        TWILIO_VERIFY_SERVICE_SID: "x",
      })
    ).toEqual({ providerIsTwilioVerify: true, requiredVarsPresent: true });
  });

  it("BILLING_PROVIDERがstripe以外、または必須変数欠落ならfalseになる", () => {
    expect(checkBillingConfig({ BILLING_PROVIDER: "disabled" })).toEqual({
      providerIsStripe: false,
      requiredVarsPresent: false,
    });
  });
});
