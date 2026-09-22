import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentContact: vi.fn(),
  sendEmailVerification: vi.fn(),
}));

vi.mock("@/server/auth/session", () => ({ getCurrentContact: mocks.currentContact }));
vi.mock("@/server/services/sendEmailVerification", () => ({
  sendEmailVerification: mocks.sendEmailVerification,
}));

import { POST } from "@/app/api/auth/verify-email/resend/route";
import { ResultEmailDeliveryError } from "@/server/providers/email/resendEmailProvider";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.currentContact.mockResolvedValue({
    id: "contact-1",
    email: "owner@example.com",
    emailVerifiedAt: null,
    emailVerificationExpiresAt: null,
    clinic: { name: "テスト歯科" },
  });
  mocks.sendEmailVerification.mockResolvedValue("sent");
});

describe("POST /api/auth/verify-email/resend: 外部障害時のエラーハンドリング", () => {
  it("メール送信が失敗(ResultEmailDeliveryError)した場合、502で明確な日本語エラーを返す(500クラッシュにしない)", async () => {
    mocks.sendEmailVerification.mockRejectedValue(new ResultEmailDeliveryError("Resend API error"));
    const response = await POST();
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: "確認メールを送信できませんでした。時間をおいて再度お試しください",
    });
  });

  it("正常系は200でstatusを返す", async () => {
    const response = await POST();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "sent" });
  });

  it("未ログインは401", async () => {
    mocks.currentContact.mockResolvedValue(null);
    const response = await POST();
    expect(response.status).toBe(401);
  });
});
