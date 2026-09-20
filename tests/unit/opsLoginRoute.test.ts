import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  verifyPassword: vi.fn(),
  createOperatorSession: vi.fn(),
  setOperatorSessionCookie: vi.fn(),
  recordAuditLog: vi.fn(),
}));

vi.mock("@/server/db/prismaClient", () => ({
  prisma: { operator: { findUnique: mocks.findUnique } },
}));
vi.mock("@/server/auth/password", () => ({ verifyPassword: mocks.verifyPassword }));
vi.mock("@/server/auth/operatorSession", () => ({
  createOperatorSession: mocks.createOperatorSession,
  setOperatorSessionCookie: mocks.setOperatorSessionCookie,
}));
vi.mock("@/server/db/auditLogRepository", () => ({ recordAuditLog: mocks.recordAuditLog }));

import { POST } from "@/app/api/ops/auth/login/route";

function request(body: unknown) {
  return new NextRequest("https://dent-shift.example.com/api/ops/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createOperatorSession.mockResolvedValue("token-1");
  mocks.recordAuditLog.mockResolvedValue(undefined);
});

describe("POST /api/ops/auth/login", () => {
  it("正しい認証情報でログインし、監査ログを記録する", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "op_1",
      email: "ops@example.com",
      passwordHash: "hashed",
      role: "admin",
    });
    mocks.verifyPassword.mockResolvedValue(true);

    const response = await POST(request({ email: "ops@example.com", password: "correct" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ operatorId: "op_1", role: "admin" });
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ operatorId: "op_1", action: "ops_login" })
    );
  });

  it("存在しないメールとパスワード誤りを同一エラーに畳む(存在有無を漏らさない)", async () => {
    mocks.findUnique.mockResolvedValue(null);
    const responseUnknown = await POST(request({ email: "nobody@example.com", password: "x" }));

    mocks.findUnique.mockResolvedValue({ id: "op_2", email: "ops@example.com", passwordHash: "hashed", role: "cs" });
    mocks.verifyPassword.mockResolvedValue(false);
    const responseWrongPassword = await POST(request({ email: "ops@example.com", password: "wrong" }));

    expect(responseUnknown.status).toBe(401);
    expect(responseWrongPassword.status).toBe(401);
    expect(await responseUnknown.json()).toEqual(await responseWrongPassword.json());
  });
});
