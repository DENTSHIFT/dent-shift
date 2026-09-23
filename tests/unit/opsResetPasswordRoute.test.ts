import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHash } from "node:crypto";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  update: vi.fn(),
  deleteMany: vi.fn(),
  transaction: vi.fn(),
  verifyPassword: vi.fn(),
  hashPassword: vi.fn(),
  recordAuditLog: vi.fn(),
}));

vi.mock("@/server/db/prismaClient", () => ({
  prisma: {
    operator: { findFirst: mocks.findFirst, update: mocks.update },
    operatorSession: { deleteMany: mocks.deleteMany },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/server/auth/password", () => ({
  verifyPassword: mocks.verifyPassword,
  hashPassword: mocks.hashPassword,
}));
vi.mock("@/server/db/auditLogRepository", () => ({ recordAuditLog: mocks.recordAuditLog }));

import { POST } from "@/app/api/ops/auth/reset-password/route";

function request(body: unknown) {
  return new NextRequest("https://dent-shift.example.com/api/ops/auth/reset-password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const RAW_TOKEN = "valid-raw-token";
const TOKEN_HASH = createHash("sha256").update(RAW_TOKEN).digest("hex");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findFirst.mockResolvedValue({
    id: "operator-1",
    email: "ops@example.com",
    passwordHash: "salt:hash",
    passwordResetTokenHash: TOKEN_HASH,
    passwordResetExpiresAt: new Date(Date.now() + 60_000),
  });
  mocks.verifyPassword.mockResolvedValue(false);
  mocks.hashPassword.mockResolvedValue("newsalt:newhash");
  mocks.transaction.mockImplementation(async (ops: unknown[]) => Promise.all(ops));
  mocks.update.mockResolvedValue({});
  mocks.deleteMany.mockResolvedValue({ count: 0 });
  mocks.recordAuditLog.mockResolvedValue(undefined);
});

describe("POST /api/ops/auth/reset-password", () => {
  it("トークンが存在しなければ400、DBは更新しない", async () => {
    mocks.findFirst.mockResolvedValue(null);
    const response = await POST(request({ token: "unknown", newPassword: "newpassword1" }));
    expect(response.status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("期限切れトークンは400", async () => {
    mocks.findFirst.mockResolvedValue({
      id: "operator-1",
      passwordHash: "salt:hash",
      passwordResetTokenHash: TOKEN_HASH,
      passwordResetExpiresAt: new Date(Date.now() - 1000),
    });
    const response = await POST(request({ token: RAW_TOKEN, newPassword: "newpassword1" }));
    expect(response.status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("使用済み(passwordResetExpiresAtがnull)トークンの再利用は拒否", async () => {
    mocks.findFirst.mockResolvedValue({
      id: "operator-1",
      passwordHash: "salt:hash",
      passwordResetTokenHash: null,
      passwordResetExpiresAt: null,
    });
    const response = await POST(request({ token: RAW_TOKEN, newPassword: "newpassword1" }));
    expect(response.status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("新しいパスワードが要件を満たさなければ400", async () => {
    const response = await POST(request({ token: RAW_TOKEN, newPassword: "short" }));
    expect(response.status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("7文字以下は400", async () => {
    const response = await POST(request({ token: RAW_TOKEN, newPassword: "abc1234" }));
    expect(response.status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("英字のみ(数字なし)は400", async () => {
    const response = await POST(request({ token: RAW_TOKEN, newPassword: "abcdefgh" }));
    expect(response.status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("数字のみ(英字なし)は400", async () => {
    const response = await POST(request({ token: RAW_TOKEN, newPassword: "12345678" }));
    expect(response.status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("記号を含んでいても要件を満たせば成功", async () => {
    const response = await POST(request({ token: RAW_TOKEN, newPassword: "abc123!?" }));
    expect(response.status).toBe(200);
  });

  it("絵文字を含まなくても成功(絵文字は必須ではない)", async () => {
    const response = await POST(request({ token: RAW_TOKEN, newPassword: "abcdefg1" }));
    expect(response.status).toBe(200);
  });

  it("現在のパスワードと同一なら400", async () => {
    mocks.verifyPassword.mockResolvedValue(true);
    const response = await POST(request({ token: RAW_TOKEN, newPassword: "samepassword1" }));
    expect(response.status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("正常系: パスワード更新・トークン無効化・全セッション削除・監査ログ記録を1トランザクションで行う", async () => {
    const response = await POST(request({ token: RAW_TOKEN, newPassword: "newpassword1" }));
    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "operator-1" },
      data: { passwordHash: "newsalt:newhash", passwordResetTokenHash: null, passwordResetExpiresAt: null },
    });
    expect(mocks.deleteMany).toHaveBeenCalledWith({ where: { operatorId: "operator-1" } });
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "ops_reset_password", targetId: "operator-1" })
    );
  });
});
