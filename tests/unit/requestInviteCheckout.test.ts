import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getInviteByCode: vi.fn(),
  resolveBillingConfig: vi.fn(),
  createInviteCheckout: vi.fn(),
}));

vi.mock("@/server/db/inviteRepository", () => ({
  getInviteByCode: mocks.getInviteByCode,
}));
vi.mock("@/server/config/billingConfig", async () => {
  const actual = await vi.importActual<typeof import("@/server/config/billingConfig")>(
    "@/server/config/billingConfig"
  );
  return { ...actual, resolveBillingConfigFromProcessEnv: mocks.resolveBillingConfig };
});
vi.mock("@/server/providers/billing/stripeCheckoutProvider", () => ({
  createStripeInviteCheckoutSession: mocks.createInviteCheckout,
}));

import { requestInviteCheckout, InviteCheckoutError } from "@/server/services/invites/requestInviteCheckout";

const ACTIVE_INVITE = {
  id: "invite-1",
  inviteCode: "ABC123",
  clinicName: "サンプル知人歯科",
  email: "owner@example.com",
  specialPriceJpy: 1,
  durationMonths: 3,
  stripePriceId: "price_invite_monitor",
  startsAt: new Date("2026-09-01T00:00:00Z"),
  expiresAt: null,
  maxUses: 1,
  usedCount: 0,
  requireEmailMatch: true,
  status: "active",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getInviteByCode.mockResolvedValue(ACTIVE_INVITE);
  mocks.resolveBillingConfig.mockReturnValue({
    provider: "stripe",
    apiKey: "sk_test_secret",
    appBaseUrl: "https://dent-shift.example.com",
  });
  mocks.createInviteCheckout.mockResolvedValue({ url: "https://checkout.stripe.com/c/pay/invite", id: "cs_1" });
});

describe("requestInviteCheckout", () => {
  it("招待が存在しない場合はnot_foundエラー", async () => {
    mocks.getInviteByCode.mockResolvedValue(null);
    await expect(
      requestInviteCheckout({ inviteCode: "XXX", clinicId: "clinic-1", contactEmail: "owner@example.com" })
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("失効済み招待もnot_foundエラー", async () => {
    mocks.getInviteByCode.mockResolvedValue({ ...ACTIVE_INVITE, status: "used" });
    await expect(
      requestInviteCheckout({ inviteCode: "ABC123", clinicId: "clinic-1", contactEmail: "owner@example.com" })
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("requireEmailMatch=trueで登録メールが招待メールと一致しない場合はemail_mismatch", async () => {
    await expect(
      requestInviteCheckout({
        inviteCode: "ABC123",
        clinicId: "clinic-1",
        contactEmail: "someone-else@example.com",
      })
    ).rejects.toMatchObject({ code: "email_mismatch" });
    expect(mocks.createInviteCheckout).not.toHaveBeenCalled();
  });

  it("メール一致・有効な招待ならCheckout URLを返し、plan=standard・cancel_atを渡す", async () => {
    const result = await requestInviteCheckout({
      inviteCode: "ABC123",
      clinicId: "clinic-1",
      contactEmail: "owner@example.com",
    });
    expect(result.checkoutUrl).toBe("https://checkout.stripe.com/c/pay/invite");
    expect(mocks.createInviteCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        priceId: "price_invite_monitor",
        clinicId: "clinic-1",
        metadata: expect.objectContaining({
          plan: "standard",
          inviteCode: "ABC123",
          inviteId: "invite-1",
        }),
      })
    );
  });

  it("Stripe課金無効時はconfig_errorになる", async () => {
    mocks.resolveBillingConfig.mockReturnValue({ provider: "disabled" });
    await expect(
      requestInviteCheckout({ inviteCode: "ABC123", clinicId: "clinic-1", contactEmail: "owner@example.com" })
    ).rejects.toMatchObject({ code: "config_error" });
  });

  it("InviteCheckoutErrorはErrorのサブクラス", async () => {
    mocks.getInviteByCode.mockResolvedValue(null);
    try {
      await requestInviteCheckout({ inviteCode: "XXX", clinicId: "clinic-1", contactEmail: "a@example.com" });
      expect.fail("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(InviteCheckoutError);
    }
  });
});
