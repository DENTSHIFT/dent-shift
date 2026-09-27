import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  currentContact: vi.fn(),
  resolveConfig: vi.fn(),
  createCheckout: vi.fn(),
  retrieveCheckout: vi.fn(),
  getLatestSubscription: vi.fn(),
  getClinicTrialState: vi.fn(),
  reserveTrialEntitlement: vi.fn(),
  attachStripeSessionToReservation: vi.fn(),
  releaseOwnReservation: vi.fn(),
}));

vi.mock("@/server/auth/session", () => ({ getCurrentContact: mocks.currentContact }));
vi.mock("@/server/config/billingConfig", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/config/billingConfig")>();
  return {
    ...actual,
    resolveBillingConfigFromProcessEnv: mocks.resolveConfig,
    BillingConfigError: class BillingConfigError extends Error {},
  };
});
vi.mock("@/server/providers/billing/stripeCheckoutProvider", () => ({
  createStripeCheckoutSession: mocks.createCheckout,
  retrieveStripeCheckoutSession: mocks.retrieveCheckout,
}));
vi.mock("@/server/db/billingRepository", () => ({
  getLatestSubscriptionByClinicId: mocks.getLatestSubscription,
}));
vi.mock("@/server/db/trialEntitlementRepository", () => ({
  getClinicTrialState: mocks.getClinicTrialState,
  reserveTrialEntitlement: mocks.reserveTrialEntitlement,
  attachStripeSessionToReservation: mocks.attachStripeSessionToReservation,
  releaseOwnReservation: mocks.releaseOwnReservation,
}));
vi.mock("@/server/db/integrationEventRepository", () => ({
  enqueueIntegrationEvent: vi.fn().mockResolvedValue(undefined),
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

const D = new Date("2026-09-01T00:00:00Z");
const READY_CONTACT = {
  clinicId: "clinic-1",
  email: "owner@example.com",
  phoneVerifiedAt: D,
  smsVerificationExempt: false,
  emailVerifiedAt: D,
  consentAcceptedAt: D,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.currentContact.mockResolvedValue(READY_CONTACT);
  mocks.resolveConfig.mockReturnValue({
    provider: "disabled",
    priceLabels: { light: null, standard: null, premium: null },
  });
  mocks.createCheckout.mockResolvedValue({
    url: "https://checkout.stripe.com/c/pay/test-session",
    id: "cs_test_session",
    expiresAtEpochSeconds: null,
    livemode: false,
  });
  mocks.getLatestSubscription.mockResolvedValue(null);
  // 既定: この医院はまだトライアルを消費していない(=ライト/スタンダードでトライアル対象)。
  mocks.getClinicTrialState.mockResolvedValue({ trialConsumedAt: null });
  mocks.reserveTrialEntitlement.mockResolvedValue({
    outcome: "reserved",
    entitlementId: "entitlement-1",
    ownerToken: "owner-token-1",
  });
  mocks.attachStripeSessionToReservation.mockResolvedValue(true);
  mocks.releaseOwnReservation.mockResolvedValue(undefined);
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
      expectedMode: "test",
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
      trialEntitlementId: "entitlement-1",
    });
    expect(mocks.attachStripeSessionToReservation).toHaveBeenCalledWith({
      entitlementId: "entitlement-1",
      ownerToken: "owner-token-1",
      checkoutSessionId: "cs_test_session",
      expiresAt: expect.any(Date),
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
      expectedMode: "test",
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

  describe("Checkout開始前のサーバー側ガード(SMS・メール・規約同意)", () => {
    function ready() {
      mocks.resolveConfig.mockReturnValue({
        provider: "stripe",
        apiKey: "sk_test_secret",
        webhookSecret: "whsec_test_secret",
        taxRateId: "txr_japan_10_percent",
        appBaseUrl: "https://dent-shift.example.com",
        priceLabels: { light: "L", standard: "S", premium: "P" },
        stripePriceIds: { light: "price_l", standard: "price_s", premium: "price_p" },
        expectedMode: "test",
      });
    }

    it.each([
      ["SMS未認証", { phoneVerifiedAt: null }],
      ["メール未確認", { emailVerifiedAt: null }],
      ["規約未同意", { consentAcceptedAt: null }],
    ])("%sならCheckoutを作成せずダッシュボードへ戻す", async (_label, override) => {
      ready();
      mocks.currentContact.mockResolvedValue({ ...READY_CONTACT, ...override });

      const response = await POST(request("light"));
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("https://dent-shift.example.com/dashboard");
      expect(mocks.createCheckout).not.toHaveBeenCalled();
    });

    it("3条件が揃っていればCheckout可能(ライト・スタンダードは7日トライアル)", async () => {
      ready();
      for (const plan of ["light", "standard"] as const) {
        mocks.createCheckout.mockClear();
        const response = await POST(request(plan));
        expect(response.status).toBe(303);
        expect(mocks.createCheckout).toHaveBeenCalledWith(
          expect.objectContaining({ plan, trialPeriodDays: 7 })
        );
      }
    });

    it("smsVerificationExempt(運営の個別例外)のContactはSMS未認証でもCheckout可能", async () => {
      ready();
      mocks.currentContact.mockResolvedValue({
        ...READY_CONTACT,
        phoneVerifiedAt: null,
        smsVerificationExempt: true,
      });
      const response = await POST(request("light"));
      expect(response.status).toBe(303);
      expect(mocks.createCheckout).toHaveBeenCalled();
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
      expectedMode: "test",
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
      expectedMode: "test",
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

  describe("2026-09-27追加(PO承認、P0-Checkout接続): TrialEntitlement予約フロー", () => {
    it("トライアル消費済みの医院はライト/スタンダードでもトライアル無しでCheckoutできる", async () => {
      stripeReadyConfig();
      mocks.getClinicTrialState.mockResolvedValue({ trialConsumedAt: new Date("2026-09-01T00:00:00Z") });

      const response = await POST(request("light"));
      expect(response.status).toBe(303);
      expect(mocks.reserveTrialEntitlement).not.toHaveBeenCalled();
      expect(mocks.createCheckout).toHaveBeenCalledWith(
        expect.objectContaining({ plan: "light", trialPeriodDays: undefined })
      );
      expect(mocks.createCheckout.mock.calls[0]?.[0]).not.toHaveProperty("trialEntitlementId");
    });

    it("既に別リクエストがSession作成中(reservation_in_progress)の場合は409を返しSessionを作らない", async () => {
      stripeReadyConfig();
      mocks.reserveTrialEntitlement.mockResolvedValue({ outcome: "reservation_in_progress" });

      const response = await POST(request("light"));
      expect(response.status).toBe(409);
      expect(mocks.createCheckout).not.toHaveBeenCalled();
    });

    it("同じ処理の安全な再試行(existing_session)は既存Stripe Sessionを再利用し新規Sessionを作らない", async () => {
      stripeReadyConfig();
      mocks.reserveTrialEntitlement.mockResolvedValue({
        outcome: "existing_session",
        entitlementId: "entitlement-1",
        checkoutSessionId: "cs_existing",
      });
      mocks.retrieveCheckout.mockResolvedValue({
        id: "cs_existing",
        status: "open",
        url: "https://checkout.stripe.com/c/pay/existing-session",
      });

      const response = await POST(request("light"));
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(
        "https://checkout.stripe.com/c/pay/existing-session"
      );
      expect(mocks.createCheckout).not.toHaveBeenCalled();
    });

    it("既存Sessionが既に期限切れ・完了済み(open以外)の場合は425で再試行を促す", async () => {
      stripeReadyConfig();
      mocks.reserveTrialEntitlement.mockResolvedValue({
        outcome: "existing_session",
        entitlementId: "entitlement-1",
        checkoutSessionId: "cs_existing",
      });
      mocks.retrieveCheckout.mockResolvedValue({
        id: "cs_existing",
        status: "expired",
        url: null,
      });

      const response = await POST(request("light"));
      expect(response.status).toBe(425);
      expect(mocks.createCheckout).not.toHaveBeenCalled();
    });

    it("予約直前に消費済みへ変わっていた(already_consumed)場合はトライアル無しで契約できる", async () => {
      stripeReadyConfig();
      mocks.reserveTrialEntitlement.mockResolvedValue({ outcome: "already_consumed" });

      const response = await POST(request("light"));
      expect(response.status).toBe(303);
      expect(mocks.createCheckout).toHaveBeenCalledWith(
        expect.objectContaining({ plan: "light", trialPeriodDays: undefined })
      );
    });

    it("Stripe Session作成が失敗した場合、自分の予約だけをreleaseする", async () => {
      stripeReadyConfig();
      mocks.createCheckout.mockRejectedValue(new Error("stripe down"));

      const response = await POST(request("light"));
      expect(response.status).toBe(502);
      expect(mocks.releaseOwnReservation).toHaveBeenCalledWith({
        entitlementId: "entitlement-1",
        ownerToken: "owner-token-1",
      });
    });

    it("Session作成成功後に予約の所有権が失われていた(attach失敗)場合はSessionを返さない", async () => {
      stripeReadyConfig();
      mocks.attachStripeSessionToReservation.mockResolvedValue(false);

      const response = await POST(request("light"));
      expect(response.status).toBe(502);
    });

    it("2026-09-28追加(PO再指摘): StripeのlivemodeがSTRIPE_EXPECTED_MODEと一致しない場合、Sessionを返さずfail-closedで停止し、自分の予約だけをreleaseする", async () => {
      stripeReadyConfig(); // expectedMode: "test"
      mocks.createCheckout.mockResolvedValue({
        url: "https://checkout.stripe.com/c/pay/test-session",
        id: "cs_test_session",
        expiresAtEpochSeconds: null,
        livemode: true, // test期待なのに実際はlive
      });

      const response = await POST(request("light"));
      expect(response.status).toBe(502);
      expect(mocks.attachStripeSessionToReservation).not.toHaveBeenCalled();
      expect(mocks.releaseOwnReservation).toHaveBeenCalledWith({
        entitlementId: "entitlement-1",
        ownerToken: "owner-token-1",
      });
    });

    it("2026-09-28追加(PO再指摘): トライアル無し経路(startCheckoutWithoutTrial)でもlivemode不一致はfail-closedで停止する", async () => {
      stripeReadyConfig();
      mocks.getClinicTrialState.mockResolvedValue({ trialConsumedAt: new Date("2026-09-01T00:00:00Z") });
      mocks.createCheckout.mockResolvedValue({
        url: "https://checkout.stripe.com/c/pay/test-session",
        id: "cs_test_session",
        expiresAtEpochSeconds: null,
        livemode: true,
      });

      const response = await POST(request("light"));
      expect(response.status).toBe(502);
    });
  });
});
