import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  currentContact: vi.fn(),
  resolveConfig: vi.fn(),
  createCheckout: vi.fn(),
  getLatestSubscription: vi.fn(),
}));

vi.mock("@/server/auth/session", () => ({ getCurrentContact: mocks.currentContact }));
vi.mock("@/server/config/billingConfig", () => ({
  resolveBillingConfigFromProcessEnv: mocks.resolveConfig,
  BillingConfigError: class BillingConfigError extends Error {},
}));
vi.mock("@/server/providers/billing/stripeCheckoutProvider", () => ({
  createStripeCheckoutSession: mocks.createCheckout,
}));
vi.mock("@/server/db/billingRepository", () => ({
  getLatestSubscriptionByClinicId: mocks.getLatestSubscription,
}));

import { POST } from "@/app/api/billing/checkout/route";

function request(plan = "standard", origin = "https://dent-shift.example.com") {
  const body = new URLSearchParams({ plan });
  return new NextRequest("https://dent-shift.example.com/api/billing/checkout", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin,
    },
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.currentContact.mockResolvedValue({
    clinicId: "clinic-1",
    email: "owner@example.com",
  });
  mocks.resolveConfig.mockReturnValue({
    provider: "disabled",
    priceLabels: { light: null, standard: null, premium: null },
  });
  mocks.createCheckout.mockResolvedValue({
    url: "https://checkout.stripe.com/c/pay/test-session",
  });
  mocks.getLatestSubscription.mockResolvedValue(null);
});

describe("POST /api/billing/checkout", () => {
  it("料金・Stripe未設定時は外部決済を開始しない", async () => {
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "オンライン契約は現在準備中です。" });
    expect(mocks.createCheckout).not.toHaveBeenCalled();
  });

  it("未ログイン時はログイン画面へ戻す", async () => {
    mocks.currentContact.mockResolvedValue(null);
    const response = await POST(request());
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://dent-shift.example.com/login");
    expect(mocks.createCheckout).not.toHaveBeenCalled();
  });

  it("同一サイトからの正しいプランだけStripe Checkoutへ渡す", async () => {
    mocks.resolveConfig.mockReturnValue({
      provider: "stripe",
      apiKey: "sk_test_secret",
      webhookSecret: "whsec_test_secret",
      taxRateId: "txr_japan_10_percent",
      appBaseUrl: "https://dent-shift.example.com",
      priceLabels: { light: "L", standard: "S", premium: "P" },
      stripePriceIds: { light: "price_l", standard: "price_s", premium: "price_p" },
    });

    const response = await POST(request("standard"));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://checkout.stripe.com/c/pay/test-session");
    expect(mocks.createCheckout).toHaveBeenCalledWith({
      apiKey: "sk_test_secret",
      priceId: "price_s",
      taxRateId: "txr_japan_10_percent",
      plan: "standard",
      clinicId: "clinic-1",
      contactEmail: "owner@example.com",
      appBaseUrl: "https://dent-shift.example.com",
      trialPeriodDays: 7,
    });
  });

  it("プレミアムプランはtrialPeriodDaysを渡さない(トライアル対象外)", async () => {
    mocks.resolveConfig.mockReturnValue({
      provider: "stripe",
      apiKey: "sk_test_secret",
      webhookSecret: "whsec_test_secret",
      taxRateId: "txr_japan_10_percent",
      appBaseUrl: "https://dent-shift.example.com",
      priceLabels: { light: "L", standard: "S", premium: "P" },
      stripePriceIds: { light: "price_l", standard: "price_s", premium: "price_p" },
    });

    const response = await POST(request("premium"));
    expect(response.status).toBe(303);
    expect(mocks.createCheckout).toHaveBeenCalledWith({
      apiKey: "sk_test_secret",
      priceId: "price_p",
      taxRateId: "txr_japan_10_percent",
      plan: "premium",
      clinicId: "clinic-1",
      contactEmail: "owner@example.com",
      appBaseUrl: "https://dent-shift.example.com",
      trialPeriodDays: undefined,
    });
  });

  it("別サイトからの送信を拒否する", async () => {
    mocks.resolveConfig.mockReturnValue({
      provider: "stripe",
      apiKey: "secret",
      webhookSecret: "whsec_secret",
      taxRateId: "txr_japan_10_percent",
      appBaseUrl: "https://dent-shift.example.com",
      priceLabels: { light: "L", standard: "S", premium: "P" },
      stripePriceIds: { light: "l", standard: "s", premium: "p" },
    });
    const response = await POST(request("standard", "https://evil.example.com"));
    expect(response.status).toBe(403);
    expect(mocks.createCheckout).not.toHaveBeenCalled();
  });

  function stripeReadyConfig() {
    mocks.resolveConfig.mockReturnValue({
      provider: "stripe",
      apiKey: "sk_test_secret",
      webhookSecret: "whsec_test_secret",
      taxRateId: "txr_japan_10_percent",
      appBaseUrl: "https://dent-shift.example.com",
      priceLabels: { light: "L", standard: "S", premium: "P" },
      stripePriceIds: { light: "price_l", standard: "price_s", premium: "price_p" },
    });
  }

  it.each([
    ["active", false],
    ["trial", false],
    ["past_due", false],
    ["restricted", false],
    ["suspended", false],
    ["cancel_scheduled", false],
  ])(
    "既存契約がstatus=%sの場合は409を返しCheckoutを作成しない(billingExempt=%s)",
    async (status, billingExempt) => {
      stripeReadyConfig();
      mocks.getLatestSubscription.mockResolvedValue({ status, billingExempt });

      const response = await POST(request("light"));
      expect(response.status).toBe(409);
      expect(mocks.createCheckout).not.toHaveBeenCalled();
    }
  );

  it("billingExempt(永久無料)は状態にかかわらずCheckoutを作成しない", async () => {
    stripeReadyConfig();
    mocks.getLatestSubscription.mockResolvedValue({ status: "active", billingExempt: true });

    const response = await POST(request("light"));
    expect(response.status).toBe(409);
    expect(mocks.createCheckout).not.toHaveBeenCalled();
  });

  it("Pilot由来(status=active)の契約もCheckoutを作成しない", async () => {
    stripeReadyConfig();
    mocks.getLatestSubscription.mockResolvedValue({
      status: "active",
      billingExempt: false,
      externalSubscriptionId: "pilot_invite123",
    });

    const response = await POST(request("light"));
    expect(response.status).toBe(409);
    expect(mocks.createCheckout).not.toHaveBeenCalled();
  });

  it("既存契約がstatus=cancelledの場合は再Checkoutを許可する", async () => {
    stripeReadyConfig();
    mocks.getLatestSubscription.mockResolvedValue({ status: "cancelled", billingExempt: false });

    const response = await POST(request("light"));
    expect(response.status).toBe(303);
    expect(mocks.createCheckout).toHaveBeenCalledTimes(1);
  });

  it("未契約(サブスクリプションなし)は通常どおりCheckoutできる", async () => {
    stripeReadyConfig();
    mocks.getLatestSubscription.mockResolvedValue(null);

    const response = await POST(request("light"));
    expect(response.status).toBe(303);
    expect(mocks.createCheckout).toHaveBeenCalledTimes(1);
  });
});
