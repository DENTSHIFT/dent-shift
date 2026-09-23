import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ verifyEmailToken: vi.fn() }));
vi.mock("@/server/services/verifyEmailToken", () => ({ verifyEmailToken: mocks.verifyEmailToken }));

import { GET } from "@/app/api/auth/verify-email/route";

function request(token?: string) {
  const url = token
    ? `https://dent-shift.example.com/api/auth/verify-email?token=${token}`
    : "https://dent-shift.example.com/api/auth/verify-email";
  return new NextRequest(url);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/auth/verify-email", () => {
  it("tokenが無ければ400", async () => {
    const response = await GET(request());
    expect(response.status).toBe(400);
    expect(mocks.verifyEmailToken).not.toHaveBeenCalled();
  });

  it("正常系: verifiedならJSONの契約(既存互換)を保つ", async () => {
    mocks.verifyEmailToken.mockResolvedValue({ status: "verified", contactId: "c1", email: "a@example.com" });
    const response = await GET(request("abc"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "verified" });
  });

  it("already_verifiedも200で返す", async () => {
    mocks.verifyEmailToken.mockResolvedValue({ status: "already_verified", contactId: "c1", email: "a@example.com" });
    const response = await GET(request("abc"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "already_verified" });
  });

  it("期限切れはcode付きの400を返す(既存互換)", async () => {
    mocks.verifyEmailToken.mockResolvedValue({ status: "error", code: "expired", message: "期限切れ" });
    const response = await GET(request("abc"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "期限切れ", code: "expired" });
  });

  it("無効なトークンはcodeなしの400を返す", async () => {
    mocks.verifyEmailToken.mockResolvedValue({ status: "error", code: "invalid", message: "無効です" });
    const response = await GET(request("abc"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "無効です" });
  });
});
