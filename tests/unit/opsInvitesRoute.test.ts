import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getCurrentOperator: vi.fn(),
  createInvite: vi.fn(),
  recordAuditLog: vi.fn(),
  resolveInviteConfig: vi.fn(),
}));

vi.mock("@/server/auth/operatorSession", () => ({ getCurrentOperator: mocks.getCurrentOperator }));
vi.mock("@/server/db/inviteRepository", () => ({ createInvite: mocks.createInvite }));
vi.mock("@/server/db/auditLogRepository", () => ({ recordAuditLog: mocks.recordAuditLog }));
vi.mock("@/server/config/inviteConfig", async () => {
  const actual = await vi.importActual<typeof import("@/server/config/inviteConfig")>(
    "@/server/config/inviteConfig"
  );
  return { ...actual, resolveInviteConfigFromProcessEnv: mocks.resolveInviteConfig };
});

import { POST } from "@/app/api/ops/invites/route";
import { InviteConfigError } from "@/server/config/inviteConfig";

function request(body: unknown) {
  return new NextRequest("https://dent-shift.example.com/api/ops/invites", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentOperator.mockResolvedValue({ id: "operator-1", email: "ops@example.com", role: "admin" });
  mocks.resolveInviteConfig.mockReturnValue({ defaultStripePriceId: "price_invite_monitor" });
  mocks.createInvite.mockResolvedValue({
    id: "invite-1",
    inviteCode: "ABC123",
    clinicName: "サンプル知人歯科",
    email: "owner@example.com",
    campaign: null,
  });
  mocks.recordAuditLog.mockResolvedValue(undefined);
});

describe("POST /api/ops/invites", () => {
  it("未ログイン(Operatorセッションなし)は401", async () => {
    mocks.getCurrentOperator.mockResolvedValue(null);
    const response = await POST(request({ clinicName: "テスト歯科", email: "a@example.com" }));
    expect(response.status).toBe(401);
    expect(mocks.createInvite).not.toHaveBeenCalled();
  });

  it("clinicNameが無ければ400", async () => {
    const response = await POST(request({ email: "a@example.com" }));
    expect(response.status).toBe(400);
  });

  it("emailが無ければ400", async () => {
    const response = await POST(request({ clinicName: "テスト歯科" }));
    expect(response.status).toBe(400);
  });

  it("招待用Price未設定時は503", async () => {
    mocks.resolveInviteConfig.mockImplementation(() => {
      throw new InviteConfigError("not set");
    });
    const response = await POST(request({ clinicName: "テスト歯科", email: "a@example.com" }));
    expect(response.status).toBe(503);
  });

  it("2026-09-23回帰: Pilot招待(campaign===\"pilot\")は、通常招待用のStripe Price設定が未整備(503相当のエラー)でも発行できる", async () => {
    mocks.resolveInviteConfig.mockImplementation(() => {
      throw new InviteConfigError("not set");
    });
    mocks.createInvite.mockResolvedValue({
      id: "invite-pilot-1",
      inviteCode: "PILOT123",
      clinicName: "サンプル知人歯科",
      email: "owner@example.com",
      campaign: "pilot",
    });
    const response = await POST(
      request({ clinicName: "サンプル知人歯科", email: "owner@example.com", campaign: "pilot" })
    );
    expect(response.status).toBe(201);
    // Pilot招待の場合、通常招待用のconfig解決自体を呼び出さない。
    expect(mocks.resolveInviteConfig).not.toHaveBeenCalled();
    expect(mocks.createInvite).toHaveBeenCalledWith(
      expect.objectContaining({ campaign: "pilot", pilotDurationDays: 28 })
    );
  });

  it("Pilot招待でpilotDurationDaysを指定すればそのまま渡される", async () => {
    const response = await POST(
      request({
        clinicName: "サンプル知人歯科",
        email: "owner@example.com",
        campaign: "pilot",
        pilotDurationDays: 21,
      })
    );
    expect(response.status).toBe(201);
    expect(mocks.createInvite).toHaveBeenCalledWith(
      expect.objectContaining({ campaign: "pilot", pilotDurationDays: 21 })
    );
  });

  it("Pilot招待でpilotDurationDaysが0以下や非整数なら400", async () => {
    const response = await POST(
      request({ clinicName: "サンプル知人歯科", email: "owner@example.com", campaign: "pilot", pilotDurationDays: 0 })
    );
    expect(response.status).toBe(400);
    expect(mocks.createInvite).not.toHaveBeenCalled();
  });

  it("正常系は招待コードを返し、監査ログを記録する", async () => {
    const response = await POST(
      request({ clinicName: "サンプル知人歯科", email: "owner@example.com", maxUses: 1 })
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ inviteCode: "ABC123", id: "invite-1" });
    expect(mocks.createInvite).toHaveBeenCalledWith(
      expect.objectContaining({
        clinicName: "サンプル知人歯科",
        email: "owner@example.com",
        stripePriceId: "price_invite_monitor",
        createdByOperatorId: "operator-1",
      })
    );
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "ops_create_invite", targetId: "invite-1" })
    );
  });
});
