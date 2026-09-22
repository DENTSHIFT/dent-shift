import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getInviteByCode: vi.fn(),
  consumeInviteForClinic: vi.fn(),
  createSubscriptionRecord: vi.fn(),
  resolvePilotInviteConfig: vi.fn(),
}));

vi.mock("@/server/db/inviteRepository", () => ({
  getInviteByCode: mocks.getInviteByCode,
  consumeInviteForClinic: mocks.consumeInviteForClinic,
}));
vi.mock("@/server/db/billingRepository", () => ({
  createSubscriptionRecord: mocks.createSubscriptionRecord,
}));
vi.mock("@/server/config/pilotInviteConfig", async () => {
  const actual = await vi.importActual<typeof import("@/server/config/pilotInviteConfig")>(
    "@/server/config/pilotInviteConfig"
  );
  return { ...actual, resolvePilotInviteConfigFromProcessEnv: mocks.resolvePilotInviteConfig };
});

import { activatePilotInvite, PilotInviteError } from "@/server/services/invites/activatePilotInvite";

const PILOT_INVITE = {
  id: "invite-pilot-1",
  inviteCode: "PILOT123",
  clinicName: "サンプル知人歯科",
  email: "sensei@example.com",
  durationMonths: 3,
  startsAt: new Date("2026-09-01T00:00:00Z"),
  expiresAt: null,
  maxUses: 1,
  usedCount: 0,
  requireEmailMatch: true,
  status: "active",
  campaign: "pilot",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolvePilotInviteConfig.mockReturnValue({ mode: "enabled" });
  mocks.getInviteByCode.mockResolvedValue(PILOT_INVITE);
  mocks.consumeInviteForClinic.mockResolvedValue(true);
  mocks.createSubscriptionRecord.mockResolvedValue({ id: "sub-1" });
});

describe("activatePilotInvite", () => {
  it("PILOT_INVITE_MODEがdisabledならdisabledエラー、Stripeも呼ばずDBも書かない", async () => {
    mocks.resolvePilotInviteConfig.mockReturnValue({ mode: "disabled" });
    await expect(
      activatePilotInvite({ inviteCode: "PILOT123", clinicId: "clinic-1", contactEmail: "sensei@example.com" })
    ).rejects.toMatchObject({ code: "disabled" });
    expect(mocks.getInviteByCode).not.toHaveBeenCalled();
    expect(mocks.createSubscriptionRecord).not.toHaveBeenCalled();
  });

  it("招待が存在しない場合はnot_found", async () => {
    mocks.getInviteByCode.mockResolvedValue(null);
    await expect(
      activatePilotInvite({ inviteCode: "XXX", clinicId: "clinic-1", contactEmail: "sensei@example.com" })
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("campaignが'pilot'でない招待(通常1円招待)はnot_found扱いで弾く", async () => {
    mocks.getInviteByCode.mockResolvedValue({ ...PILOT_INVITE, campaign: null });
    await expect(
      activatePilotInvite({ inviteCode: "PILOT123", clinicId: "clinic-1", contactEmail: "sensei@example.com" })
    ).rejects.toMatchObject({ code: "not_found" });
    expect(mocks.consumeInviteForClinic).not.toHaveBeenCalled();
  });

  it("使用済み招待はnot_found扱い", async () => {
    mocks.getInviteByCode.mockResolvedValue({ ...PILOT_INVITE, status: "used", usedCount: 1 });
    await expect(
      activatePilotInvite({ inviteCode: "PILOT123", clinicId: "clinic-1", contactEmail: "sensei@example.com" })
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("メール不一致はemail_mismatch、Invite消費もSubscription作成もしない", async () => {
    await expect(
      activatePilotInvite({
        inviteCode: "PILOT123",
        clinicId: "clinic-1",
        contactEmail: "someone-else@example.com",
      })
    ).rejects.toMatchObject({ code: "email_mismatch" });
    expect(mocks.consumeInviteForClinic).not.toHaveBeenCalled();
    expect(mocks.createSubscriptionRecord).not.toHaveBeenCalled();
  });

  it("消費に失敗した場合(競合等)はalready_used、Subscriptionは作らない", async () => {
    mocks.consumeInviteForClinic.mockResolvedValue(false);
    await expect(
      activatePilotInvite({ inviteCode: "PILOT123", clinicId: "clinic-1", contactEmail: "sensei@example.com" })
    ).rejects.toMatchObject({ code: "already_used" });
    expect(mocks.createSubscriptionRecord).not.toHaveBeenCalled();
  });

  it("正常系: standard/active・inviteId付き・3か月後のtrialEndsAtでSubscriptionを作成する", async () => {
    const result = await activatePilotInvite({
      inviteCode: "PILOT123",
      clinicId: "clinic-1",
      contactEmail: "SENSEI@example.com",
    });
    expect(mocks.consumeInviteForClinic).toHaveBeenCalledWith({
      inviteId: "invite-pilot-1",
      clinicId: "clinic-1",
    });
    expect(mocks.createSubscriptionRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        clinicId: "clinic-1",
        plan: "standard",
        status: "active",
        externalSubscriptionId: "pilot_invite-pilot-1",
        inviteId: "invite-pilot-1",
      })
    );
    expect(result.subscriptionId).toBe("sub-1");
    const startedAt = mocks.createSubscriptionRecord.mock.calls[0][0].trialStartedAt as Date;
    const endsAt = mocks.createSubscriptionRecord.mock.calls[0][0].trialEndsAt as Date;
    expect(endsAt.getUTCMonth()).toBe((startedAt.getUTCMonth() + 3) % 12);
  });

  it("PilotInviteErrorはErrorのサブクラス", async () => {
    mocks.getInviteByCode.mockResolvedValue(null);
    try {
      await activatePilotInvite({ inviteCode: "XXX", clinicId: "clinic-1", contactEmail: "a@example.com" });
      expect.fail("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(PilotInviteError);
    }
  });
});
