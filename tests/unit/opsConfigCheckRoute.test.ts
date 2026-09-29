import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentOperator: vi.fn(),
  resolveSmsConfigFromProcessEnv: vi.fn(),
  resolveBillingConfigFromProcessEnv: vi.fn(),
}));

vi.mock("@/server/auth/operatorSession", () => ({ getCurrentOperator: mocks.getCurrentOperator }));
vi.mock("@/server/config/smsConfig", () => ({
  resolveSmsConfigFromProcessEnv: mocks.resolveSmsConfigFromProcessEnv,
}));
vi.mock("@/server/config/billingConfig", () => ({
  resolveBillingConfigFromProcessEnv: mocks.resolveBillingConfigFromProcessEnv,
}));

import { GET } from "@/app/api/ops/config-check/route";

// PO指示(2026-09-30): 既存ops認証・未認証拒否・秘密値/エラー本文非出力を検証する。
// SMS送信・メール送信・決済作成は一切行わない設計であることも、fetchモックの
// 呼び出し先URLで確認する(Twilioへは一切アクセスしない)。

describe("GET /api/ops/config-check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("未認証の場合は401を返し、設定情報は一切含めない", async () => {
    mocks.getCurrentOperator.mockResolvedValue(null);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body).toEqual({ error: "ログインが必要です" });
    expect(mocks.resolveSmsConfigFromProcessEnv).not.toHaveBeenCalled();
    expect(mocks.resolveBillingConfigFromProcessEnv).not.toHaveBeenCalled();
  });

  it("401応答にもCache-Control: no-storeを付与する", async () => {
    mocks.getCurrentOperator.mockResolvedValue(null);
    const res = await GET();
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("認証済みの場合、Cache-Control: no-storeを付与し、判定結果のみ返す", async () => {
    mocks.getCurrentOperator.mockResolvedValue({ id: "op-1", email: "ops@example.com", role: "admin" });
    mocks.resolveSmsConfigFromProcessEnv.mockReturnValue({ provider: "disabled" });
    mocks.resolveBillingConfigFromProcessEnv.mockReturnValue({ provider: "disabled", priceLabels: {} });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(body).toEqual({
      sms: { providerIsTwilioVerify: false, configValid: true },
      billing: { providerIsStripe: false, configValid: true },
      prices: {},
    });
  });

  it("SMS_PROVIDER設定が不正(SmsConfigError)な場合、エラー本文を含めずfalseで返す", async () => {
    mocks.getCurrentOperator.mockResolvedValue({ id: "op-1", email: "ops@example.com", role: "admin" });
    mocks.resolveSmsConfigFromProcessEnv.mockImplementation(() => {
      throw new Error("SMS_PROVIDER='twilio-verify' requires TWILIO_ACCOUNT_SID containing secret hint");
    });
    mocks.resolveBillingConfigFromProcessEnv.mockReturnValue({ provider: "disabled", priceLabels: {} });

    const res = await GET();
    const body = await res.json();
    const bodyText = JSON.stringify(body);

    expect(body.sms).toEqual({ providerIsTwilioVerify: false, configValid: false });
    // エラーメッセージ本文が応答に一切含まれないことを確認する。
    expect(bodyText).not.toContain("TWILIO_ACCOUNT_SID");
    expect(bodyText).not.toContain("secret hint");
  });

  it("Stripe課金が有効な場合、価格IDを実際にfetchし、値・エラー本文を一切含めない判定のみ返す", async () => {
    mocks.getCurrentOperator.mockResolvedValue({ id: "op-1", email: "ops@example.com", role: "admin" });
    mocks.resolveSmsConfigFromProcessEnv.mockReturnValue({ provider: "disabled" });
    mocks.resolveBillingConfigFromProcessEnv.mockReturnValue({
      provider: "stripe",
      apiKey: "sk_live_should_not_leak",
      webhookSecret: "whsec_dummy",
      taxRateId: "txr_dummy",
      appBaseUrl: "https://dentshift.jp",
      priceLabels: {},
      stripePriceIds: {
        light: "price_light_should_not_leak",
        standard: "price_standard_should_not_leak",
        premium: "price_premium_should_not_leak",
      },
      expectedMode: "live",
    });

    const fetchCalls: string[] = [];
    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      fetchCalls.push(url);
      return {
        ok: true,
        json: async () => ({
          unit_amount: 14_800,
          currency: "jpy",
          recurring: { interval: "month" },
          livemode: true,
        }),
      };
    });
    vi.stubGlobal("fetch", mockFetch);

    const res = await GET();
    const body = await res.json();
    const bodyText = JSON.stringify(body);

    expect(res.status).toBe(200);
    expect(body.billing).toEqual({ providerIsStripe: true, configValid: true });
    expect(body.prices.light).toEqual({
      exists: true,
      amountMatches: true,
      currencyIsJpy: true,
      isMonthly: true,
      isLive: true,
    });
    // 秘密鍵・価格ID・(将来的な)Twilio関連文字列が応答本文に一切出現しないことを確認する。
    expect(bodyText).not.toContain("sk_live_should_not_leak");
    expect(bodyText).not.toContain("price_light_should_not_leak");
    expect(bodyText).not.toContain("price_standard_should_not_leak");
    expect(bodyText).not.toContain("price_premium_should_not_leak");
    // Stripeの価格取得(GET)のみで、Twilio・課金作成系エンドポイントへは一切アクセスしない。
    expect(fetchCalls.every((url) => url.startsWith("https://api.stripe.com/v1/prices/"))).toBe(true);
    expect(fetchCalls.some((url) => url.includes("checkout") || url.includes("subscriptions"))).toBe(false);
  });

  it("Stripeが404を返した場合も、エラー本文を含めずfalse判定のみ返す", async () => {
    mocks.getCurrentOperator.mockResolvedValue({ id: "op-1", email: "ops@example.com", role: "admin" });
    mocks.resolveSmsConfigFromProcessEnv.mockReturnValue({ provider: "disabled" });
    mocks.resolveBillingConfigFromProcessEnv.mockReturnValue({
      provider: "stripe",
      apiKey: "sk_live_dummy",
      webhookSecret: "whsec_dummy",
      taxRateId: "txr_dummy",
      appBaseUrl: "https://dentshift.jp",
      priceLabels: {},
      stripePriceIds: { light: "price_missing", standard: "price_missing2", premium: "price_missing3" },
      expectedMode: "live",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: { message: "No such price: 'price_missing'" } }),
      })
    );

    const res = await GET();
    const body = await res.json();
    const bodyText = JSON.stringify(body);

    expect(body.prices.light).toEqual({
      exists: false,
      amountMatches: false,
      currencyIsJpy: false,
      isMonthly: false,
      isLive: false,
    });
    expect(bodyText).not.toContain("No such price");
  });
});
