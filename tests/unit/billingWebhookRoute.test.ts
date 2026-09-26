import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class BillingConfigError extends Error {}
  class StripeWebhookVerificationError extends Error {}
  return {
    BillingConfigError,
    StripeWebhookVerificationError,
    resolveConfig: vi.fn(),
    verify: vi.fn(),
    normalize: vi.fn(),
    apply: vi.fn(),
    sendBillingStatusChangeEmail: vi.fn(),
  };
});

vi.mock("@/server/config/billingConfig", () => ({
  BillingConfigError: mocks.BillingConfigError,
  resolveBillingConfigFromProcessEnv: mocks.resolveConfig,
}));
vi.mock("@/server/providers/billing/stripeWebhookProvider", () => ({
  StripeWebhookVerificationError: mocks.StripeWebhookVerificationError,
  verifyStripeWebhookEvent: mocks.verify,
  normalizeStripeBillingEvent: mocks.normalize,
}));
vi.mock("@/server/db/billingRepository", () => ({
  applyBillingWebhookEvent: mocks.apply,
}));
vi.mock("@/server/services/sendBillingStatusChangeEmail", () => ({
  sendBillingStatusChangeEmail: mocks.sendBillingStatusChangeEmail,
}));

import { POST } from "@/app/api/billing/webhook/route";

const STRIPE_CONFIG = {
  provider: "stripe",
  apiKey: "sk_test_secret",
  webhookSecret: "whsec_secret",
  appBaseUrl: "https://dent-shift.example.com",
  priceLabels: { light: "L", standard: "S", premium: "P" },
  stripePriceIds: { light: "price_l", standard: "price_s", premium: "price_p" },
};

function request(signature: string | null = "signed") {
  const headers = new Headers({ "content-type": "application/json" });
  if (signature) headers.set("stripe-signature", signature);
  return new Request("https://dent-shift.example.com/api/billing/webhook", {
    method: "POST",
    headers,
    body: '{"raw":  true}',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveConfig.mockReturnValue(STRIPE_CONFIG);
  mocks.verify.mockReturnValue({ id: "evt_1" });
  mocks.normalize.mockReturnValue({ providerEventId: "evt_1" });
  mocks.apply.mockResolvedValue({ result: "processed", notify: null });
  mocks.sendBillingStatusChangeEmail.mockResolvedValue("sent");
});

describe("POST /api/billing/webhook", () => {
  it("契約作成前に先着したinvoiceイベント(retry)は非2xxを返し、Stripeに再送させる", async () => {
    mocks.apply.mockResolvedValue({ result: "retry", notify: null });
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ received: false, result: "retry" });
    expect(mocks.sendBillingStatusChangeEmail).not.toHaveBeenCalled();
  });

  it("orphan(存在しない医院)のイベントはignoredで200を返し、Stripeに再送させない", async () => {
    mocks.apply.mockResolvedValue({ result: "ignored", notify: null });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, result: "ignored" });
  });

  it("決済無効時は通知本文を処理しない", async () => {
    mocks.resolveConfig.mockReturnValue({
      provider: "disabled",
      priceLabels: { light: null, standard: null, premium: null },
    });
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it("署名なしを拒否する", async () => {
    const response = await POST(request(null));
    expect(response.status).toBe(400);
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it("加工前の本文を署名検証してから一度だけ適用する", async () => {
    const response = await POST(request("stripe-signature"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, result: "processed" });
    expect(mocks.verify).toHaveBeenCalledWith({
      payload: '{"raw":  true}',
      signature: "stripe-signature",
      apiKey: "sk_test_secret",
      webhookSecret: "whsec_secret",
    });
    expect(mocks.apply).toHaveBeenCalledTimes(1);
  });

  it("署名不一致をDB処理前に拒否する", async () => {
    mocks.verify.mockImplementation(() => {
      throw new mocks.StripeWebhookVerificationError();
    });
    const response = await POST(request("bad-signature"));
    expect(response.status).toBe(400);
    expect(mocks.normalize).not.toHaveBeenCalled();
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it("DB処理失敗時はStripeが再送できるよう500を返す", async () => {
    mocks.apply.mockRejectedValue(new Error("database unavailable"));
    const response = await POST(request());
    expect(response.status).toBe(500);
  });

  it("契約状態が悪化方向へ遷移した場合は通知メールを送る", async () => {
    mocks.apply.mockResolvedValue({
      result: "processed",
      notify: { clinicId: "clinic-1", toStatus: "past_due" },
    });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.sendBillingStatusChangeEmail).toHaveBeenCalledWith({
      clinicId: "clinic-1",
      status: "past_due",
    });
  });

  it("状態遷移がない場合は通知メールを送らない", async () => {
    mocks.apply.mockResolvedValue({ result: "processed", notify: null });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.sendBillingStatusChangeEmail).not.toHaveBeenCalled();
  });

  it("通知メール送信の失敗はWebhookの200応答をブロックしない", async () => {
    mocks.apply.mockResolvedValue({
      result: "processed",
      notify: { clinicId: "clinic-1", toStatus: "cancelled" },
    });
    mocks.sendBillingStatusChangeEmail.mockRejectedValue(new Error("resend down"));
    const response = await POST(request());
    expect(response.status).toBe(200);
  });
});
