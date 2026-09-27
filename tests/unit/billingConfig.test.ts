import { describe, expect, it } from "vitest";
import { BillingConfigError, resolveBillingConfig } from "@/server/config/billingConfig";

const COMPLETE_STRIPE_ENV = {
  BILLING_PROVIDER: "stripe",
  STRIPE_SECRET_KEY: "sk_test_secret",
  STRIPE_WEBHOOK_SECRET: "whsec_test_secret",
  APP_BASE_URL: "https://dent-shift.example.com/path",
  STRIPE_PRICE_ID_LIGHT: "price_light",
  STRIPE_PRICE_ID_STANDARD: "price_standard",
  STRIPE_PRICE_ID_PREMIUM: "price_premium",
  STRIPE_TAX_RATE_ID: "txr_japan_10_percent",
  // 2026-09-28追加(PO再指摘): Stripe test/live取り違え防止のfail-closedガード。
  STRIPE_EXPECTED_MODE: "test",
};

describe("billingConfig", () => {
  it("未設定時は決済を開始できないdisabledになる", () => {
    expect(resolveBillingConfig({ env: {} })).toEqual({
      provider: "disabled",
      priceLabels: {
        light: "月額14,800円（税込）",
        standard: "月額39,800円（税込）",
        premium: "月額79,800円（税込）",
      },
    });
  });

  it("Stripe接続時は3プランの表示料金とPrice IDを必須にする", () => {
    const config = resolveBillingConfig({ env: COMPLETE_STRIPE_ENV });
    expect(config.provider).toBe("stripe");
    if (config.provider !== "stripe") throw new Error("test setup failed");
    expect(config.appBaseUrl).toBe("https://dent-shift.example.com");
    expect(config.webhookSecret).toBe("whsec_test_secret");
    expect(config.taxRateId).toBe("txr_japan_10_percent");
    expect(config.stripePriceIds.standard).toBe("price_standard");
    expect(config.priceLabels.standard).toBe("月額39,800円（税込）");
  });

  it("署名検証用シークレットなしではStripeを有効化しない", () => {
    expect(() =>
      resolveBillingConfig({
        env: { ...COMPLETE_STRIPE_ENV, STRIPE_WEBHOOK_SECRET: "" },
      })
    ).toThrow(BillingConfigError);
  });

  it("一部の料金だけでStripeを有効化しない", () => {
    expect(() =>
      resolveBillingConfig({
        env: { ...COMPLETE_STRIPE_ENV, STRIPE_PRICE_ID_PREMIUM: "" },
      })
    ).toThrow(BillingConfigError);
  });

  it("消費税率なしではStripeを有効化しない", () => {
    expect(() =>
      resolveBillingConfig({
        env: { ...COMPLETE_STRIPE_ENV, STRIPE_TAX_RATE_ID: "" },
      })
    ).toThrow(BillingConfigError);
  });

  it("2026-09-28追加(PO再指摘): STRIPE_EXPECTED_MODE未設定・不明な値はfail-closedで拒否する", () => {
    expect(() =>
      resolveBillingConfig({ env: { ...COMPLETE_STRIPE_ENV, STRIPE_EXPECTED_MODE: "" } })
    ).toThrow(BillingConfigError);
    expect(() =>
      resolveBillingConfig({ env: { ...COMPLETE_STRIPE_ENV, STRIPE_EXPECTED_MODE: "sandbox" } })
    ).toThrow(BillingConfigError);
  });

  it("2026-09-28追加(PO再指摘): 未知のprefixの秘密鍵はmode判定不能としてfail-closedで拒否する", () => {
    expect(() =>
      resolveBillingConfig({ env: { ...COMPLETE_STRIPE_ENV, STRIPE_SECRET_KEY: "not_a_stripe_key" } })
    ).toThrow(BillingConfigError);
  });

  it("2026-09-28追加(PO再指摘): STRIPE_EXPECTED_MODE=testでlive用キー(sk_live_)はfail-closedで拒否する", () => {
    expect(() =>
      resolveBillingConfig({
        env: { ...COMPLETE_STRIPE_ENV, STRIPE_SECRET_KEY: "sk_live_should_not_be_used_in_test" },
      })
    ).toThrow(BillingConfigError);
  });

  it("2026-09-28追加(PO再指摘): STRIPE_EXPECTED_MODE=liveでtest用キー(sk_test_)はfail-closedで拒否する", () => {
    expect(() =>
      resolveBillingConfig({
        env: { ...COMPLETE_STRIPE_ENV, STRIPE_EXPECTED_MODE: "live", STRIPE_SECRET_KEY: "sk_live_actual_live_key" },
      })
    ).not.toThrow();
    expect(() =>
      resolveBillingConfig({
        env: { ...COMPLETE_STRIPE_ENV, STRIPE_EXPECTED_MODE: "live" },
      })
    ).toThrow(BillingConfigError);
  });

  it("2026-09-28追加(PO再指摘): 制限付きキー(rk_test_/rk_live_)のprefixもmode判定できる", () => {
    expect(() =>
      resolveBillingConfig({ env: { ...COMPLETE_STRIPE_ENV, STRIPE_SECRET_KEY: "rk_test_restricted" } })
    ).not.toThrow();
    expect(() =>
      resolveBillingConfig({ env: { ...COMPLETE_STRIPE_ENV, STRIPE_SECRET_KEY: "rk_live_restricted" } })
    ).toThrow(BillingConfigError);
  });

  it("2026-09-28追加(PO再指摘): mode不一致のエラーメッセージに秘密鍵の値・prefixの残りを含めない", () => {
    const secretSuffix = "should_not_leak_1234567890";
    let caught: unknown;
    try {
      resolveBillingConfig({
        env: { ...COMPLETE_STRIPE_ENV, STRIPE_SECRET_KEY: `sk_live_${secretSuffix}` },
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(BillingConfigError);
    expect((caught as Error).message).not.toContain(secretSuffix);
    expect((caught as Error).message).not.toContain("sk_live_");
  });

  it("APIキー値を設定エラーへ含めない", () => {
    const apiKey = "sk_test_should_not_leak";
    let caught: unknown;
    try {
      resolveBillingConfig({
        env: { ...COMPLETE_STRIPE_ENV, STRIPE_SECRET_KEY: apiKey, APP_BASE_URL: "invalid" },
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(BillingConfigError);
    expect((caught as Error).message).not.toContain(apiKey);
  });
});
