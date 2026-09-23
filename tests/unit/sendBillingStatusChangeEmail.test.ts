import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  resolveResultEmailConfig: vi.fn(),
  sendWithResend: vi.fn(),
}));

vi.mock("@/server/db/prismaClient", () => ({
  prisma: { contact: { findMany: mocks.findMany } },
}));
vi.mock("@/server/config/resultEmailConfig", () => ({
  resolveResultEmailConfigFromProcessEnv: mocks.resolveResultEmailConfig,
}));
vi.mock("@/server/providers/email/resendEmailProvider", () => ({
  sendWithResend: mocks.sendWithResend,
}));

import {
  sendBillingStatusChangeEmail,
  BillingStatusEmailConfigError,
} from "@/server/services/sendBillingStatusChangeEmail";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findMany.mockResolvedValue([{ email: "owner@example.com" }]);
  mocks.sendWithResend.mockResolvedValue(undefined);
  mocks.resolveResultEmailConfig.mockReturnValue({
    provider: "resend",
    apiKey: "unused-diagnosis-key",
    from: "noreply@dent-shift.mcollection-japan.jp",
    appBaseUrl: "https://dentshift.jp",
  });
  process.env.RESEND_API_KEY_DENTSHIFT = "dentshift-key";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("sendBillingStatusChangeEmail", () => {
  it("trial/active/cancel_scheduledは通知対象外としてメールを送らない", async () => {
    for (const status of ["trial", "active", "cancel_scheduled"] as const) {
      const result = await sendBillingStatusChangeEmail({ clinicId: "clinic-1", status });
      expect(result).toBe("disabled");
    }
    expect(mocks.sendWithResend).not.toHaveBeenCalled();
  });

  it("メール基盤がdisabledなら送信せずdisabledを返す", async () => {
    mocks.resolveResultEmailConfig.mockReturnValue({ provider: "disabled" });
    const result = await sendBillingStatusChangeEmail({ clinicId: "clinic-1", status: "past_due" });
    expect(result).toBe("disabled");
    expect(mocks.sendWithResend).not.toHaveBeenCalled();
  });

  it("RESEND_API_KEY_DENTSHIFT未設定はエラーを投げる", async () => {
    delete process.env.RESEND_API_KEY_DENTSHIFT;
    await expect(
      sendBillingStatusChangeEmail({ clinicId: "clinic-1", status: "past_due" })
    ).rejects.toBeInstanceOf(BillingStatusEmailConfigError);
  });

  it("宛先Contactが存在しない場合はno_recipientsを返す", async () => {
    mocks.findMany.mockResolvedValue([]);
    const result = await sendBillingStatusChangeEmail({ clinicId: "clinic-1", status: "past_due" });
    expect(result).toBe("no_recipients");
    expect(mocks.sendWithResend).not.toHaveBeenCalled();
  });

  it("past_dueはお支払い確認の文面をclinicの全Contactへ送る", async () => {
    mocks.findMany.mockResolvedValue([
      { email: "owner@example.com" },
      { email: "staff@example.com" },
    ]);
    const result = await sendBillingStatusChangeEmail({ clinicId: "clinic-1", status: "past_due" });
    expect(result).toBe("sent");
    expect(mocks.sendWithResend).toHaveBeenCalledTimes(2);
    const firstCall = mocks.sendWithResend.mock.calls[0]![0];
    expect(firstCall.apiKey).toBe("dentshift-key");
    expect(firstCall.from).toBe("support@dentshift.jp");
    expect(firstCall.to).toBe("owner@example.com");
    expect(firstCall.message.subject).toContain("お支払い");
    expect(firstCall.message.text).toContain("https://dentshift.jp/dashboard");
    // 秘密情報(APIキー・Stripe ID等)が本文に混入していないことを確認する。
    expect(firstCall.message.text).not.toContain("dentshift-key");
  });

  it("restricted/suspendedもpast_dueと同じお支払い確認文面を送る", async () => {
    for (const status of ["restricted", "suspended"] as const) {
      mocks.sendWithResend.mockClear();
      await sendBillingStatusChangeEmail({ clinicId: "clinic-1", status });
      const call = mocks.sendWithResend.mock.calls[0]![0];
      expect(call.message.subject).toContain("お支払い");
    }
  });

  it("cancelledは解約通知の文面を送る", async () => {
    const result = await sendBillingStatusChangeEmail({ clinicId: "clinic-1", status: "cancelled" });
    expect(result).toBe("sent");
    const call = mocks.sendWithResend.mock.calls[0]![0];
    expect(call.message.subject).toContain("終了");
    expect(call.message.text).toContain("再度お申し込み");
  });
});
