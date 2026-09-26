import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCurrentContact, getSub, upgrade } = vi.hoisted(() => ({
  getCurrentContact: vi.fn(),
  getSub: vi.fn(),
  upgrade: vi.fn(),
}));

vi.mock("@/server/auth/session", () => ({ getCurrentContact }));
vi.mock("@/server/db/billingRepository", () => ({ getLatestSubscriptionByClinicId: getSub }));
vi.mock("@/server/providers/billing/stripeSubscriptionUpgradeProvider", () => ({
  upgradeStripeSubscriptionPlan: upgrade,
}));
vi.mock("@/server/config/billingConfig", () => ({
  BillingConfigError: class extends Error {},
  resolveBillingConfigFromProcessEnv: () => ({
    provider: "stripe",
    apiKey: "k",
    taxRateId: "txr_1",
    stripePriceIds: { light: "price_l", standard: "price_s", premium: "price_p" },
  }),
}));

import { POST } from "@/app/api/billing/upgrade/route";

const req = (body: unknown) =>
  ({
    headers: new Headers(),
    nextUrl: { origin: "http://x" },
    json: async () => body,
  }) as never;

const sub = (over: Record<string, unknown> = {}) => ({
  plan: "light",
  status: "trial",
  billingExempt: false,
  inviteId: null,
  externalSubscriptionId: "sub_1",
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentContact.mockResolvedValue({ clinicId: "c1" });
});

describe("POST /api/billing/upgrade", () => {
  it("Price IDはサーバー側でプランから決め、クライアント指定は無視する", async () => {
    getSub.mockResolvedValue(sub());
    const res = await POST(req({ targetPlan: "premium", priceId: "price_evil" }));
    expect(res.status).toBe(200);
    expect(upgrade).toHaveBeenCalledWith(
      expect.objectContaining({ priceId: "price_p", targetPlan: "premium", proration: "none" })
    );
  });
  it("有効契約は差額を即時請求", async () => {
    getSub.mockResolvedValue(sub({ plan: "standard", status: "active" }));
    await POST(req({ targetPlan: "premium" }));
    expect(upgrade).toHaveBeenCalledWith(expect.objectContaining({ proration: "always_invoice" }));
  });
  it("ダウングレード・同一プランは400でStripeを呼ばない", async () => {
    getSub.mockResolvedValue(sub({ plan: "premium", status: "active" }));
    expect((await POST(req({ targetPlan: "standard" }))).status).toBe(400);
    expect((await POST(req({ targetPlan: "premium" }))).status).toBe(400);
    expect(upgrade).not.toHaveBeenCalled();
  });
  it("免除・招待・未ログイン・不正プランは拒否", async () => {
    getSub.mockResolvedValue(sub({ billingExempt: true }));
    expect((await POST(req({ targetPlan: "premium" }))).status).toBe(409);
    getSub.mockResolvedValue(sub({ inviteId: "inv" }));
    expect((await POST(req({ targetPlan: "premium" }))).status).toBe(409);
    getSub.mockResolvedValue(sub());
    expect((await POST(req({ targetPlan: "enterprise" }))).status).toBe(400);
    getCurrentContact.mockResolvedValue(null);
    expect((await POST(req({ targetPlan: "premium" }))).status).toBe(401);
    expect(upgrade).not.toHaveBeenCalled();
  });
});
