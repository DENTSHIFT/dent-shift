import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  currentContact: vi.fn(),
  update: vi.fn(),
  resolveSmsConfig: vi.fn(),
  checkVerification: vi.fn(),
  enqueueIntegrationEvent: vi.fn(),
  activateTrialIfEligible: vi.fn(),
}));

vi.mock("@/server/auth/session", () => ({ getCurrentContact: mocks.currentContact }));
vi.mock("@/server/db/prismaClient", () => ({
  prisma: { contact: { update: mocks.update } },
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
    createTwilioVerifySmsProvider: () => ({ checkVerification: mocks.checkVerification }),
  };
});
vi.mock("@/server/db/integrationEventRepository", () => ({
  enqueueIntegrationEvent: mocks.enqueueIntegrationEvent,
}));
vi.mock("@/server/services/activateTrial", () => ({
  activateTrialIfEligible: mocks.activateTrialIfEligible,
}));

import { POST } from "@/app/api/auth/phone/verify/route";
import { SmsDeliveryError } from "@/server/providers/sms/twilioVerifySmsProvider";

function request(body: unknown) {
  return new NextRequest("https://dent-shift.example.com/api/auth/phone/verify", {
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
    phoneNumber: "+819012345678",
    smsStatus: "sent",
    smsAttemptCount: 0,
    registrationStep: "sms",
  });
  mocks.resolveSmsConfig.mockReturnValue({
    provider: "twilio-verify",
    accountSid: "AC_test",
    authToken: "token",
    verifyServiceSid: "VA_test",
  });
  mocks.checkVerification.mockResolvedValue("approved");
  mocks.update.mockResolvedValue({});
  mocks.enqueueIntegrationEvent.mockResolvedValue(undefined);
  mocks.activateTrialIfEligible.mockResolvedValue(undefined);
});

describe("POST /api/auth/phone/verify: 外部障害時のエラーハンドリング", () => {
  it("Twilio確認が失敗(SmsDeliveryError)した場合、502で明確な日本語エラーを返す(500クラッシュにしない)", async () => {
    mocks.checkVerification.mockRejectedValue(new SmsDeliveryError("Twilio API error"));
    const response = await POST(request({ code: "123456" }));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: "確認コードを確認できませんでした。時間をおいて再度お試しください",
    });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("正常系(approved)は200を返す", async () => {
    const response = await POST(request({ code: "123456" }));
    expect(response.status).toBe(200);
  });
});
