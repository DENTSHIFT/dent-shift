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

  it("新しいパスワードが8文字未満なら400", async () => {
    const response = await POST(request({ currentPassword: "current", newPassword: "a1🔥" }));
    expect(response.status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("数字を含まなければ400", async () => {
    const response = await POST(request({ currentPassword: "current", newPassword: "abcdefgh🔥" }));
    expect(response.status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("絵文字を含まなければ400", async () => {
    const response = await POST(request({ currentPassword: "current", newPassword: "abcdefg1" }));
    expect(response.status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("現在のパスワードと同一なら400", async () => {
    const response = await POST(request({ currentPassword: "current", newPassword: "current" }));
    expect(response.status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("正常系: ハッシュ化した新パスワードで更新し、監査ログを残す", async () => {
    const response = await POST(request({ currentPassword: "current", newPassword: "newpassword1🔥" }));
    expect(response.status).toBe(200);
    expect(mocks.hashPassword).toHaveBeenCalledWith("newpassword1🔥");
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "operator-1" },
      data: { passwordHash: "newsalt:newhash" },
    });
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "ops_change_password", targetId: "operator-1" })
    );
  });

  it("新しいパスワードの平文は監査ログのmetadataに含まれない", async () => {
    await POST(request({ currentPassword: "current", newPassword: "newpassword1🔥" }));
    const call = mocks.recordAuditLog.mock.calls[0]![0];
    expect(JSON.stringify(call)).not.toContain("newpassword1🔥");
  });
});
