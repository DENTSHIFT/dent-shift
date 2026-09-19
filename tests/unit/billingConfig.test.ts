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
