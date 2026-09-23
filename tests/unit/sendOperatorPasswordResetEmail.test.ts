import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  resolveResultEmailConfig: vi.fn(),
  sendWithResend: vi.fn(),
}));

vi.mock("@/server/db/prismaClient", () => ({
  prisma: { operator: { update: mocks.update } },
}));
vi.mock("@/server/config/resultEmailConfig", () => ({
  resolveResultEmailConfigFromProcessEnv: mocks.resolveResultEmailConfig,
}));
vi.mock("@/server/providers/email/resendEmailProvider", () => ({
  sendWithResend: mocks.sendWithResend,
}));

import {
  sendOperatorPasswordResetEmail,
  OperatorPasswordResetEmailConfigError,
} from "@/server/services/sendOperatorPasswordResetEmail";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.update.mockResolvedValue({});
  mocks.sendWithResend.mockResolvedValue(undefined);
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("sendOperatorPasswordResetEmail", () => {
  it("RESULT_EMAIL_PROVIDERがdisabledならメール送信せずdisabledを返す(トークンは保存する)", async () => {
    mocks.resolveResultEmailConfig.mockReturnValue({ provider: "disabled" });
    const result = await sendOperatorPasswordResetEmail({
      operatorId: "operator-1",
      email: "ops@example.com",
    });
    expect(result).toBe("disabled");
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "operator-1" } })
    );
    expect(mocks.sendWithResend).not.toHaveBeenCalled();
  });

  it("RESEND_API_KEY_DENTSHIFTが未設定ならエラーを投げ、既存のRESEND_API_KEYは参照しない", async () => {
    mocks.resolveResultEmailConfig.mockReturnValue({
      provider: "resend",
      apiKey: "existing-diagnosis-key-should-not-be-used",
      from: "noreply@dent-shift.mcollection-japan.jp",
      appBaseUrl: "https://dentshift.jp",
    });
    delete process.env.RESEND_API_KEY_DENTSHIFT;

    await expect(
      sendOperatorPasswordResetEmail({ operatorId: "operator-1", email: "ops@example.com" })
    ).rejects.toBeInstanceOf(OperatorPasswordResetEmailConfigError);
    expect(mocks.sendWithResend).not.toHaveBeenCalled();
  });

  it("正常系: RESEND_API_KEY_DENTSHIFTを使い、送信元support@dentshift.jp・件名・本文中のURLが本番reset-passwordを指す", async () => {
    mocks.resolveResultEmailConfig.mockReturnValue({
      provider: "resend",
      apiKey: "existing-diagnosis-key-should-not-be-used",
      from: "noreply@dent-shift.mcollection-japan.jp",
      appBaseUrl: "https://dentshift.jp",
    });
    process.env.RESEND_API_KEY_DENTSHIFT = "dentshift-only-key";

    const result = await sendOperatorPasswordResetEmail({
      operatorId: "operator-1",
      email: "ops@example.com",
    });

    expect(result).toBe("sent");
    expect(mocks.sendWithResend).toHaveBeenCalledTimes(1);
    const call = mocks.sendWithResend.mock.calls[0]![0];
    expect(call.apiKey).toBe("dentshift-only-key");
    expect(call.apiKey).not.toBe("existing-diagnosis-key-should-not-be-used");
    expect(call.from).toBe("support@dentshift.jp");
    expect(call.to).toBe("ops@example.com");
    expect(call.message.subject).toBe("【DENT SHIFT】管理者パスワード再設定");
    expect(call.message.text).toMatch(/^https:\/\/dentshift\.jp\/ops\/reset-password\?token=/m);
    expect(call.message.html).toContain("https://dentshift.jp/ops/reset-password?token=");
  });
});
