import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  currentContact: vi.fn(),
  activatePilotInvite: vi.fn(),
}));

vi.mock("@/server/auth/session", () => ({ getCurrentContact: mocks.currentContact }));
vi.mock("@/server/services/invites/activatePilotInvite", async () => {
  const actual = await vi.importActual<
    typeof import("@/server/services/invites/activatePilotInvite")
  >("@/server/services/invites/activatePilotInvite");
  return { ...actual, activatePilotInvite: mocks.activatePilotInvite };
});

import { POST } from "@/app/api/invites/[code]/pilot-activate/route";
import { PilotInviteError } from "@/server/services/invites/activatePilotInvite";

function request(origin = "https://test.dentshift.jp") {
  return new NextRequest("https://test.dentshift.jp/api/invites/PILOT123/pilot-activate", {
    method: "POST",
    headers: { origin },
  });
}
function params(code = "PILOT123") {
  return { params: Promise.resolve({ code }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.currentContact.mockResolvedValue({ id: "contact-1", clinicId: "clinic-1", email: "sensei@example.com" });
  mocks.activatePilotInvite.mockResolvedValue({
    subscriptionId: "sub-1",
    startedAt: new Date(),
    endsAt: new Date(),
  });
});

describe("POST /api/invites/[code]/pilot-activate", () => {
  it("未ログインは401", async () => {
    mocks.currentContact.mockResolvedValue(null);
    const response = await POST(request(), params());
    expect(response.status).toBe(401);
    expect(mocks.activatePilotInvite).not.toHaveBeenCalled();
  });

  it("別サイトからの送信は403", async () => {
    const response = await POST(request("https://evil.example.com"), params());
    expect(response.status).toBe(403);
    expect(mocks.activatePilotInvite).not.toHaveBeenCalled();
  });

  it("正常系はsubscriptionIdを返す", async () => {
    const response = await POST(request(), params());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.subscriptionId).toBe("sub-1");
    expect(mocks.activatePilotInvite).toHaveBeenCalledWith({
      inviteCode: "PILOT123",
      clinicId: "clinic-1",
      contactEmail: "sensei@example.com",
    });
  });

  it("パイロット無効(disabled)なら404", async () => {
    mocks.activatePilotInvite.mockRejectedValue(new PilotInviteError("無効です", "disabled"));
    const response = await POST(request(), params());
    expect(response.status).toBe(404);
  });

  it("招待なし(not_found)なら404", async () => {
    mocks.activatePilotInvite.mockRejectedValue(new PilotInviteError("見つかりません", "not_found"));
    const response = await POST(request(), params());
    expect(response.status).toBe(404);
  });

  it("メール不一致(email_mismatch)なら403", async () => {
    mocks.activatePilotInvite.mockRejectedValue(new PilotInviteError("不一致です", "email_mismatch"));
    const response = await POST(request(), params());
    expect(response.status).toBe(403);
  });

  it("使用済み(already_used)なら409", async () => {
    mocks.activatePilotInvite.mockRejectedValue(new PilotInviteError("使用済みです", "already_used"));
    const response = await POST(request(), params());
    expect(response.status).toBe(409);
  });
});
