import { beforeEach, describe, expect, it, vi } from "vitest";

const contactFindUnique = vi.fn();
const contactFindFirst = vi.fn();
const contactUpdate = vi.fn();
const sessionDeleteMany = vi.fn();
const transaction = vi.fn();
const sendVerification = vi.fn();
const checkVerification = vi.fn();

const afterTasks: Array<() => unknown> = [];
vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  after: (task: () => unknown) => {
    afterTasks.push(task);
  },
}));
const flushAfter = async () => {
  while (afterTasks.length) await afterTasks.shift()!();
};

vi.mock("@/server/db/prismaClient", () => ({
  prisma: {
    contact: { findUnique: contactFindUnique, findFirst: contactFindFirst, update: contactUpdate },
    session: { deleteMany: sessionDeleteMany },
    $transaction: transaction,
  },
}));
vi.mock("@/server/config/smsConfig", () => ({
  resolveSmsConfigFromProcessEnv: () => ({ provider: "twilio-verify", accountSid: "a", authToken: "b", verifyServiceSid: "c" }),
}));
vi.mock("@/server/providers/sms/twilioVerifySmsProvider", () => ({
  createTwilioVerifySmsProvider: () => ({ sendVerification, checkVerification }),
}));
vi.mock("@/server/auth/password", () => ({
  hashPassword: async () => "newhash",
  verifyPassword: async (p: string) => p === "Current123",
}));

const req = (body: unknown) =>
  new Request("http://x/api", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }) as never;

const eligible = {
  id: "c1", email: "a@example.com", passwordHash: "old", phoneNumber: "+819012345678",
  phoneVerifiedAt: new Date(), smsVerificationExempt: false,
  passwordResetSmsSentAt: null, passwordResetSmsWindowStartedAt: null,
  passwordResetSmsSendCount: 0, passwordResetSmsAttemptCount: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  transaction.mockImplementation(async (ops: unknown[]) => Promise.all(ops));
});

describe("SMS再設定 send", () => {
  it("認証済み番号のContactにだけ送り、応答は同一", async () => {
    const { POST } = await import("@/app/api/auth/password-reset/sms/send/route");
    contactFindUnique.mockResolvedValueOnce(eligible);
    const a = await POST(req({ email: "a@example.com" }));
    expect(sendVerification).not.toHaveBeenCalled();
    await flushAfter();
    expect(sendVerification).toHaveBeenCalledWith("+819012345678");

    sendVerification.mockClear();
    contactFindUnique.mockResolvedValueOnce({ ...eligible, phoneVerifiedAt: null, smsVerificationExempt: true });
    const b = await POST(req({ email: "a@example.com" }));
    contactFindUnique.mockResolvedValueOnce(null);
    const c = await POST(req({ email: "none@example.com" }));
    await flushAfter();
    expect(sendVerification).not.toHaveBeenCalled();
    const [aj, bj, cj] = [await a.json(), await b.json(), await c.json()];
    expect(bj).toEqual(aj);
    expect(cj).toEqual(aj);
    expect(b.status).toBe(200);
    expect(c.status).toBe(200);
  });
});

describe("SMS再設定 verify", () => {
  const pending = { ...eligible, passwordResetSmsSentAt: new Date() };
  it("コード承認時のみトークンを発行する(DBにはhashのみ)", async () => {
    const { POST } = await import("@/app/api/auth/password-reset/sms/verify/route");
    contactFindUnique.mockResolvedValueOnce(pending);
    checkVerification.mockResolvedValueOnce("approved");
    const res = await POST(req({ email: "a@example.com", code: "123456" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(typeof body.token).toBe("string");
    const stored = contactUpdate.mock.calls[0]![0].data.passwordResetTokenHash;
    expect(stored).not.toBe(body.token);
  });
  it("誤コード・アカウントなしは同一の400", async () => {
    const { POST } = await import("@/app/api/auth/password-reset/sms/verify/route");
    contactFindUnique.mockResolvedValueOnce(pending);
    checkVerification.mockResolvedValueOnce("denied");
    const wrong = await POST(req({ email: "a@example.com", code: "000000" }));
    contactFindUnique.mockResolvedValueOnce(null);
    const none = await POST(req({ email: "x@example.com", code: "000000" }));
    expect(wrong.status).toBe(400);
    const [wj, nj] = [await wrong.json(), await none.json()];
    expect(wj).toEqual(nj);
    expect(contactUpdate.mock.calls[0]![0].data.passwordResetSmsAttemptCount).toEqual({ increment: 1 });
  });
  it("電話番号未認証のContactはTwilioを呼ばず400", async () => {
    const { POST } = await import("@/app/api/auth/password-reset/sms/verify/route");
    contactFindUnique.mockResolvedValueOnce({ ...pending, phoneVerifiedAt: null });
    const res = await POST(req({ email: "a@example.com", code: "123456" }));
    expect(res.status).toBe(400);
    expect(checkVerification).not.toHaveBeenCalled();
  });
});

describe("パスワード更新", () => {
  const contact = { id: "c1", passwordHash: "old", passwordResetExpiresAt: new Date(Date.now() + 60_000) };
  it("成功時にトークンを失効し全セッションを削除する", async () => {
    const { POST } = await import("@/app/api/auth/password-reset/reset/route");
    contactFindFirst.mockResolvedValueOnce(contact);
    const res = await POST(req({ token: "tok", newPassword: "Newpass123" }));
    expect(res.status).toBe(200);
    expect(contactUpdate.mock.calls[0]![0].data).toMatchObject({
      passwordHash: "newhash", passwordResetTokenHash: null, passwordResetExpiresAt: null,
    });
    expect(sessionDeleteMany).toHaveBeenCalledWith({ where: { contactId: "c1" } });
  });
  it("期限切れ・弱いパスワード・現在と同じは拒否", async () => {
    const { POST } = await import("@/app/api/auth/password-reset/reset/route");
    contactFindFirst.mockResolvedValueOnce({ ...contact, passwordResetExpiresAt: new Date(Date.now() - 1) });
    expect((await POST(req({ token: "tok", newPassword: "Newpass123" }))).status).toBe(400);
    contactFindFirst.mockResolvedValueOnce(contact);
    expect((await POST(req({ token: "tok", newPassword: "short" }))).status).toBe(400);
    contactFindFirst.mockResolvedValueOnce(contact);
    expect((await POST(req({ token: "tok", newPassword: "Current123" }))).status).toBe(400);
    expect(sessionDeleteMany).not.toHaveBeenCalled();
  });
});
