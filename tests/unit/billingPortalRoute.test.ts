import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  currentContact: vi.fn(),
  resolveConfig: vi.fn(),
  latestSubscription: vi.fn(),
  createPortal: vi.fn(),
}));

vi.mock("@/server/auth/session", () => ({ getCurrentContact: mocks.currentContact }));
vi.mock("@/server/config/billingConfig", () => ({
  resolveBillingConfigFromProcessEnv: mocks.resolveConfig,
  BillingConfigError: class BillingConfigError extends Error {},
}));
vi.mock("@/server/db/billingRepository", () => ({
  getLatestSubscriptionByClinicId: mocks.latestSubscription,
}));
vi.mock("@/server/providers/billing/stripeCustomerPortalProvider", () => ({
  createStripeCustomerPortalSession: mocks.createPortal,
}));

import { POST } from "@/app/api/billing/portal/route";

function request(origin = "https://dent-shift.example.com") {
  return new NextRequest("https://dent-shift.example.com/api/billing/portal", {
    method: "POST",
    headers: { origin },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.currentContact.mockResolvedValue({ clinicId: "clinic-1" });
  mocks.resolveConfig.mockReturnValue({
    provider: "stripe",
    apiKey: "sk_test_secret",
    appBaseUrl: "https://dent-shift.example.com",
  });
  mocks.latestSubscription.mockResolvedValue({
    externalSubscriptionId: "sub_subscription1",
  });
  mocks.createPortal.mockResolvedValue({
    url: "https://billing.stripe.com/p/session/test-session",
  });
});

describe("POST /api/billing/portal", () => {
  it("未ログイン時はログイン画面へ戻す", async () => {
    mocks.currentContact.mockResolvedValue(null);

    const response = await POST(request());

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://dent-shift.example.com/login");
    expect(mocks.createPortal).not.toHaveBeenCalled();
  });

  it("別サイトからの送信を拒否する", async () => {
    const response = await POST(request("https://evil.example.com"));

    expect(response.status).toBe(403);
    expect(mocks.createPortal).not.toHaveBeenCalled();
  });

  it("契約がない場合は管理画面を作らない", async () => {
    mocks.latestSubscription.mockResolvedValue(null);

    const response = await POST(request());

    expect(response.status).toBe(404);
    expect(mocks.createPortal).not.toHaveBeenCalled();
  });

  it("Stripe契約番号がない旧データでは管理画面を作らない", async () => {
    mocks.latestSubscription.mockResolvedValue({ externalSubscriptionId: null });

    const response = await POST(request());

    expect(response.status).toBe(404);
    expect(mocks.createPortal).not.toHaveBeenCalled();
  });

  it("ログイン医院の契約からStripe管理画面へ移動する", async () => {
    const response = await POST(request());

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://billing.stripe.com/p/session/test-session"
    );
    expect(mocks.latestSubscription).toHaveBeenCalledWith("clinic-1");
    expect(mocks.createPortal).toHaveBeenCalledWith({
      apiKey: "sk_test_secret",
      externalSubscriptionId: "sub_subscription1",
      appBaseUrl: "https://dent-shift.example.com",
    });
  });
});
