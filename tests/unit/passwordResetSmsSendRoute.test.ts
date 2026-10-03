import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  resolveSmsConfig: vi.fn(),
  sendVerification: vi.fn(),
  afterCallback: null as (() => Promise<void> | void) | null,
}));

// after()はNext.jsがレスポンス返却後にバックグラウンドで実行するコールバックを登録するだけで、
// 本番ランタイムではPOST()の中で待たれない。テストではコールバックを捕捉し、
// POST()が解決した後に明示的に実行することで、配線(実際のルート経由)を検証する。
vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return {
    ...actual,
    after: (callback: () => Promise<void> | void) => {
      mocks.afterCallback = callback;
    },
  };
});

vi.mock("@/server/db/prismaClient", () => ({
  prisma: { contact: { findUnique: mocks.findUnique, update: mocks.update } },
}));
vi.mock("@/server/config/smsConfig", async () => {
  const actual = await vi.importActual<typeof import("@/server/config/smsConfig")>(
    "@/server/config/smsConfig"
  );
  return { ...actual, resolveSmsConfigFromProcessEnv: mocks.resolveSmsConfig };
});
vi.mock("@/server/providers/sms/twilioVerifySmsProvider", async () => {
  const actual = await vi.importActual<
    typeof import("@/server/providers/sms/twilioVerifySmsProvider")
  >("@/server/providers/sms/twilioVerifySmsProvider");
  return {
    ...actual,
    createTwilioVerifySmsProvider: () => ({ sendVerification: mocks.sendVerification }),
  };
});

import { POST } from "@/app/api/auth/password-reset/sms/send/route";

function request(body: unknown) {
  return new NextRequest("https://dent-shift.example.com/api/auth/password-reset/sms/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const BASE_CONTACT = {
  id: "contact-1",
  email: "test@example.com",
  phoneNumber: "+819012345678",
  phoneVerifiedAt: new Date("2026-01-01T00:00:00Z"),
  passwordResetSmsSentAt: null,
  passwordResetSmsWindowStartedAt: null,
  passwordResetSmsSendCount: 0,
  passwordResetSmsAttemptCount: 0,
};

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.afterCallback = null;
  process.env.APP_BASE_URL = "https://test.dentshift.jp";
  delete process.env.SMS_TEST_ALLOWED_CONTACT_ID;
  delete process.env.SMS_TEST_ALLOWED_PHONE;
  mocks.findUnique.mockResolvedValue({ ...BASE_CONTACT });
  mocks.resolveSmsConfig.mockReturnValue({
    provider: "twilio-verify",
    accountSid: "AC_test",
    authToken: "token",
    verifyServiceSid: "VA_test",
  });
  mocks.sendVerification.mockResolvedValue(undefined);
  mocks.update.mockResolvedValue({});
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

async function runPostAndAfter(body: unknown) {
  const response = await POST(request(body));
  // after()はPOST()の中では待たれない。実際のルート配線を検証するため、
  // 捕捉したコールバックをここで明示的に実行する。
  await mocks.afterCallback?.();
  return response;
}

describe("POST /api/auth/password-reset/sms/send: 対象限定ガード(未認証経路、実ルート経由)", () => {
  it("非本番で許可された組み合わせなら送信される", async () => {
    process.env.SMS_TEST_ALLOWED_CONTACT_ID = "contact-1";
    process.env.SMS_TEST_ALLOWED_PHONE = "+819012345678";
    const response = await runPostAndAfter({ email: "test@example.com" });
    expect(response.status).toBe(200);
    expect(mocks.sendVerification).toHaveBeenCalledTimes(1);
    expect(mocks.sendVerification).toHaveBeenCalledWith("+819012345678");
  });

  it("非本番で許可設定が未設定(欠落)ならTwilio呼び出しは0回", async () => {
    const response = await runPostAndAfter({ email: "test@example.com" });
    expect(response.status).toBe(200); // レスポンス自体は常に同一(タイミング攻撃対策)
    expect(mocks.sendVerification).not.toHaveBeenCalled();
  });

  it("APP_BASE_URLが未設定・不正な値でも本番と断定せず、許可リスト未設定ならTwilio呼び出しは0回", async () => {
    delete process.env.APP_BASE_URL;
    const response = await runPostAndAfter({ email: "test@example.com" });
    expect(response.status).toBe(200);
    expect(mocks.sendVerification).not.toHaveBeenCalled();

    process.env.APP_BASE_URL = "not a url";
    const response2 = await runPostAndAfter({ email: "test@example.com" });
    expect(response2.status).toBe(200);
    expect(mocks.sendVerification).not.toHaveBeenCalled();
  });

  it("Contact IDは一致するが電話番号が不一致ならTwilio呼び出しは0回", async () => {
    process.env.SMS_TEST_ALLOWED_CONTACT_ID = "contact-1";
    process.env.SMS_TEST_ALLOWED_PHONE = "+819099999999";
    const response = await runPostAndAfter({ email: "test@example.com" });
    expect(response.status).toBe(200);
    expect(mocks.sendVerification).not.toHaveBeenCalled();
  });

  it("電話番号は一致するがContact IDが不一致ならTwilio呼び出しは0回", async () => {
    process.env.SMS_TEST_ALLOWED_CONTACT_ID = "contact-other";
    process.env.SMS_TEST_ALLOWED_PHONE = "+819012345678";
    const response = await runPostAndAfter({ email: "test@example.com" });
    expect(response.status).toBe(200);
    expect(mocks.sendVerification).not.toHaveBeenCalled();
  });

  it("本番ドメインでは許可リスト未設定でも従来どおり送信される(本番の既存動作を変えない)", async () => {
    process.env.APP_BASE_URL = "https://dentshift.jp";
    const response = await runPostAndAfter({ email: "test@example.com" });
    expect(response.status).toBe(200);
    expect(mocks.sendVerification).toHaveBeenCalledTimes(1);
  });
});
