import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getCurrentOperator: vi.fn(),
  update: vi.fn(),
  verifyPassword: vi.fn(),
  hashPassword: vi.fn(),
  recordAuditLog: vi.fn(),
}));

vi.mock("@/server/auth/operatorSession", () => ({ getCurrentOperator: mocks.getCurrentOperator }));
vi.mock("@/server/db/prismaClient", () => ({
  prisma: { operator: { update: mocks.update } },
}));
vi.mock("@/server/auth/password", () => ({
  verifyPassword: mocks.verifyPassword,
  hashPassword: mocks.hashPassword,
}));
vi.mock("@/server/db/auditLogRepository", () => ({ recordAuditLog: mocks.recordAuditLog }));

import { POST } from "@/app/api/ops/auth/change-password/route";

function request(body: unknown) {
  return new NextRequest("https://dent-shift.example.com/api/ops/auth/change-password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentOperator.mockResolvedValue({
    id: "operator-1",
    email: "ops@example.com",
    passwordHash: "salt:hash",
  });
  mocks.verifyPassword.mockResolvedValue(true);
  mocks.hashPassword.mockResolvedValue("newsalt:newhash");
  mocks.update.mockResolvedValue({});
  mocks.recordAuditLog.mockResolvedValue(undefined);
});

describe("POST /api/ops/auth/change-password", () => {
  it("未ログインは401", async () => {
    mocks.getCurrentOperator.mockResolvedValue(null);
    const response = await POST(request({ currentPassword: "a", newPassword: "newpassword123" }));
    expect(response.status).toBe(401);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("現在のパスワードが違えば401、DBは更新しない", async () => {
    mocks.verifyPassword.mockResolvedValue(false);
    const response = await POST(request({ currentPassword: "wrong", newPassword: "newpassword123" }));
    expect(response.status).toBe(401);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("7文字以下は400", async () => {
    const response = await POST(request({ currentPassword: "current1", newPassword: "abc1234" }));
    expect(response.status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("数字を含まなければ400", async () => {
    const response = await POST(request({ currentPassword: "current1", newPassword: "abcdefgh" }));
    expect(response.status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("英字を含まなければ400", async () => {
    const response = await POST(request({ currentPassword: "current1", newPassword: "12345678" }));
    expect(response.status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("現在のパスワードと同一なら400", async () => {
    const response = await POST(request({ currentPassword: "current123", newPassword: "current123" }));
    expect(response.status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("正常系: 英字+数字8文字以上ならハッシュ化した新パスワードで更新し、監査ログを残す", async () => {
    const response = await POST(request({ currentPassword: "current1", newPassword: "newpassword1" }));
    expect(response.status).toBe(200);
    expect(mocks.hashPassword).toHaveBeenCalledWith("newpassword1");
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "operator-1" },
      data: { passwordHash: "newsalt:newhash" },
    });
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "ops_change_password", targetId: "operator-1" })
    );
  });

  it("記号を含む新パスワードでもvalidなら成功", async () => {
    const response = await POST(request({ currentPassword: "current1", newPassword: "abc123!?" }));
    expect(response.status).toBe(200);
  });

  it("絵文字を含まなくても成功(絵文字は必須ではない)", async () => {
    const response = await POST(request({ currentPassword: "current1", newPassword: "abcdefg1" }));
    expect(response.status).toBe(200);
  });

  it("新しいパスワードの平文は監査ログのmetadataに含まれない", async () => {
    await POST(request({ currentPassword: "current1", newPassword: "newpassword1" }));
    const call = mocks.recordAuditLog.mock.calls[0]![0];
    expect(JSON.stringify(call)).not.toContain("newpassword1");
  });
});
