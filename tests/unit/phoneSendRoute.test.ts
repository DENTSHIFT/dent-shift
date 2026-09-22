import { beforeEach, describe, expect, it, vi } from "vitest";
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
