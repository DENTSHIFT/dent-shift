import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  currentContact: vi.fn(),
  findFirst: vi.fn(),
  update: vi.fn(),
  resolveSmsConfig: vi.fn(),
  sendVerification: vi.fn(),
  enqueueIntegrationEvent: vi.fn(),
}));

vi.mock("@/server/auth/session", () => ({ getCurrentContact: mocks.currentContact }));
vi.mock("@/server/db/prismaClient", () => ({
  prisma: { contact: { findFirst: mocks.findFirst, update: mocks.update } },
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
vi.mock("@/server/db/integrationEventRepository", () => ({
  enqueueIntegrationEvent: mocks.enqueueIntegrationEvent,
}));

import { POST } from "@/app/api/auth/phone/send/route";
import { SmsDeliveryError } from "@/server/providers/sms/twilioVerifySmsProvider";

function request(body: unknown) {
  return new NextRequest("https://dent-shift.example.com/api/auth/phone/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // 既定では本番ドメインを想定し、対象限定ガード(非本番では必須)がこのファイルの
  // 他のテスト(ガード自体を検証する下のdescribeを除く)に影響しないようにする。
  process.env.APP_BASE_URL = "https://dentshift.jp";
  delete process.env.SMS_TEST_ALLOWED_CONTACT_ID;
  delete process.env.SMS_TEST_ALLOWED_PHONE;
  mocks.currentContact.mockResolvedValue({
    id: "contact-1",
    clinicId: "clinic-1",
    phoneNumber: null,
    smsStatus: null,
    smsSentAt: null,
    smsResendCount: 0,
    registrationStep: "sms",
  });
  mocks.findFirst.mockResolvedValue(null);
  mocks.resolveSmsConfig.mockReturnValue({
    provider: "twilio-verify",
    accountSid: "AC_test",
    authToken: "token",
    verifyServiceSid: "VA_test",
  });
  mocks.sendVerification.mockResolvedValue(undefined);
  mocks.update.mockResolvedValue({});
  mocks.enqueueIntegrationEvent.mockResolvedValue(undefined);
});

describe("POST /api/auth/phone/send: 外部障害時のエラーハンドリング", () => {
  it("Twilio送信が失敗(SmsDeliveryError)した場合、502で明確な日本語エラーを返す(500クラッシュにしない)", async () => {
    mocks.sendVerification.mockRejectedValue(new SmsDeliveryError("Twilio API error"));
    const response = await POST(request({ phoneNumber: "09012345678" }));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: "SMSを送信できませんでした。時間をおいて再度お試しください",
    });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("SMS未設定(disabled)の場合は503", async () => {
    mocks.resolveSmsConfig.mockReturnValue({ provider: "disabled" });
    const response = await POST(request({ phoneNumber: "09012345678" }));
    expect(response.status).toBe(503);
  });

  it("正常系は200で送信済みを返す", async () => {
    const response = await POST(request({ phoneNumber: "09012345678" }));
    expect(response.status).toBe(200);
    expect(mocks.sendVerification).toHaveBeenCalledWith("+819012345678");
  });
});

describe("POST /api/auth/phone/send: 再送制限", () => {
  it("1分以内の再送は429で、Twilioを呼ばない", async () => {
    mocks.currentContact.mockResolvedValue({
      id: "contact-1",
      clinicId: "clinic-1",
      phoneNumber: "+819012345678",
      smsStatus: "sent",
      smsSentAt: new Date(Date.now() - 1000 * 10),
      smsResendCount: 0,
      registrationStep: "sms",
    });
    const response = await POST(request({ phoneNumber: "09012345678" }));
    expect(response.status).toBe(429);
    expect((await response.json()).error).toBe("再送は1分間隔でのみ可能です");
    expect(mocks.sendVerification).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("送信回数の上限を超えると429で、Twilioを呼ばない", async () => {
    mocks.currentContact.mockResolvedValue({
      id: "contact-1",
      clinicId: "clinic-1",
      phoneNumber: "+819012345678",
      smsStatus: "sent",
      smsSentAt: new Date(Date.now() - 1000 * 60 * 10),
      smsResendCount: 5,
      registrationStep: "sms",
    });
    const response = await POST(request({ phoneNumber: "09012345678" }));
    expect(response.status).toBe(429);
    expect((await response.json()).error).toBe(
      "送信回数の上限に達しました。時間をおいて再度お試しください"
    );
    expect(mocks.sendVerification).not.toHaveBeenCalled();
  });

  it("誤入力ロック中(クールダウン内)は429でTwilioを呼ばない", async () => {
    mocks.currentContact.mockResolvedValue({
      id: "contact-1",
      clinicId: "clinic-1",
      phoneNumber: "+819012345678",
      smsStatus: "locked",
      smsSentAt: new Date(Date.now() - 1000 * 60 * 5), // 5分前(クールダウン15分以内)
      smsResendCount: 0,
      registrationStep: "sms",
    });
    const response = await POST(request({ phoneNumber: "09012345678" }));
    expect(response.status).toBe(429);
    expect((await response.json()).error).toBe(
      "誤入力の上限に達しました。しばらく待ってから再度お試しください"
    );
    expect(mocks.sendVerification).not.toHaveBeenCalled();
  });

  it("ロックのクールダウン経過後は再送できる", async () => {
    mocks.currentContact.mockResolvedValue({
      id: "contact-1",
      clinicId: "clinic-1",
      phoneNumber: "+819012345678",
      smsStatus: "locked",
      smsSentAt: new Date(Date.now() - 1000 * 60 * 20), // 20分前(クールダウン15分超過)
      smsResendCount: 0,
      registrationStep: "sms",
    });
    const response = await POST(request({ phoneNumber: "09012345678" }));
    expect(response.status).toBe(200);
    expect(mocks.sendVerification).toHaveBeenCalledWith("+819012345678");
  });
});

describe("POST /api/auth/phone/send: 送信失敗からの復帰", () => {
  it("Twilio送信失敗後、再試行すれば正常に送信できる", async () => {
    mocks.sendVerification.mockRejectedValueOnce(new SmsDeliveryError("Twilio API error"));
    const first = await POST(request({ phoneNumber: "09012345678" }));
    expect(first.status).toBe(502);
    expect(mocks.update).not.toHaveBeenCalled();

    mocks.sendVerification.mockResolvedValueOnce(undefined);
    const second = await POST(request({ phoneNumber: "09012345678" }));
    expect(second.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/auth/phone/send: 対象限定ガード(非本番環境では必須)", () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("非本番(test.dentshift.jp)で許可された組み合わせなら送信される", async () => {
    process.env.APP_BASE_URL = "https://test.dentshift.jp";
    process.env.SMS_TEST_ALLOWED_CONTACT_ID = "contact-1";
    process.env.SMS_TEST_ALLOWED_PHONE = "+819012345678";
    const response = await POST(request({ phoneNumber: "09012345678" }));
    expect(response.status).toBe(200);
    expect(mocks.sendVerification).toHaveBeenCalledTimes(1);
  });

  it("非本番で許可設定が未設定(欠落)ならTwilio呼び出しは0回(設定漏れを送信許可にしない)", async () => {
    process.env.APP_BASE_URL = "https://test.dentshift.jp";
    delete process.env.SMS_TEST_ALLOWED_CONTACT_ID;
    delete process.env.SMS_TEST_ALLOWED_PHONE;
    const response = await POST(request({ phoneNumber: "09012345678" }));
    expect(response.status).toBe(503);
    expect(mocks.sendVerification).not.toHaveBeenCalled();
  });

  it("APP_BASE_URL自体が未設定でも本番と断定せず、Twilio呼び出しは0回", async () => {
    delete process.env.APP_BASE_URL;
    delete process.env.SMS_TEST_ALLOWED_CONTACT_ID;
    delete process.env.SMS_TEST_ALLOWED_PHONE;
    const response = await POST(request({ phoneNumber: "09012345678" }));
    expect(response.status).toBe(503);
    expect(mocks.sendVerification).not.toHaveBeenCalled();
  });

  it("非本番で許可設定の電話番号が不正な形式ならTwilio呼び出しは0回", async () => {
    process.env.APP_BASE_URL = "https://test.dentshift.jp";
    process.env.SMS_TEST_ALLOWED_CONTACT_ID = "contact-1";
    process.env.SMS_TEST_ALLOWED_PHONE = "090-1234-5678";
    const response = await POST(request({ phoneNumber: "09012345678" }));
    expect(response.status).toBe(503);
    expect(mocks.sendVerification).not.toHaveBeenCalled();
  });

  it("Contact IDは一致するが電話番号が不一致ならTwilio呼び出しは0回", async () => {
    process.env.APP_BASE_URL = "https://test.dentshift.jp";
    process.env.SMS_TEST_ALLOWED_CONTACT_ID = "contact-1";
    process.env.SMS_TEST_ALLOWED_PHONE = "+819099999999";
    const response = await POST(request({ phoneNumber: "09012345678" }));
    expect(response.status).toBe(503);
    expect(mocks.sendVerification).not.toHaveBeenCalled();
  });

  it("電話番号は一致するがContact IDが不一致ならTwilio呼び出しは0回", async () => {
    process.env.APP_BASE_URL = "https://test.dentshift.jp";
    process.env.SMS_TEST_ALLOWED_CONTACT_ID = "contact-other";
    process.env.SMS_TEST_ALLOWED_PHONE = "+819012345678";
    const response = await POST(request({ phoneNumber: "09012345678" }));
    expect(response.status).toBe(503);
    expect(mocks.sendVerification).not.toHaveBeenCalled();
  });

  it("本番ドメイン(dentshift.jp)では許可リスト未設定でも従来どおり送信される(本番の既存動作を変えない)", async () => {
    process.env.APP_BASE_URL = "https://dentshift.jp";
    delete process.env.SMS_TEST_ALLOWED_CONTACT_ID;
    delete process.env.SMS_TEST_ALLOWED_PHONE;
    const response = await POST(request({ phoneNumber: "09012345678" }));
    expect(response.status).toBe(200);
    expect(mocks.sendVerification).toHaveBeenCalledTimes(1);
  });
});
