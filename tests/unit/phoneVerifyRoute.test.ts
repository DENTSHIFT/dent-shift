import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  currentContact: vi.fn(),
  update: vi.fn(),
  resolveSmsConfig: vi.fn(),
  checkVerification: vi.fn(),
  enqueueIntegrationEvent: vi.fn(),
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
    consentAcceptedAt: null,
    clinic: {
      name: "テスト歯科",
      directorName: "テスト院長",
      url: "https://example.com",
    },
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

  it("電話番号のような入力はTwilioを呼ばず、案内付きの400を返す(失敗回数も増やさない)", async () => {
    const response = await POST(request({ code: "090-1234-5678" }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("電話番号ではなく");
    expect(mocks.checkVerification).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("形式が不正な入力もTwilioを呼ばず400", async () => {
    const response = await POST(request({ code: "abc" }));
    expect(response.status).toBe(400);
    expect(mocks.checkVerification).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/phone/verify: 誤コード入力・期限切れ・再試行上限", () => {
  it("誤コード(denied)の場合、400で失敗回数を加算し、上限未満ならlockedにしない", async () => {
    mocks.checkVerification.mockResolvedValue("denied");
    const response = await POST(request({ code: "123456" }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("確認コードが正しくありません");
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "contact-1" },
      data: { smsAttemptCount: 1, smsStatus: "failed" },
    });
  });

  it("誤コードが上限回数(5回目)に達するとlockedになる", async () => {
    mocks.currentContact.mockResolvedValue({
      id: "contact-1",
      clinicId: "clinic-1",
      phoneNumber: "+819012345678",
      smsStatus: "sent",
      smsAttemptCount: 4,
      registrationStep: "sms",
      consentAcceptedAt: null,
      clinic: { name: "テスト歯科", directorName: "テスト院長", url: "https://example.com" },
    });
    mocks.checkVerification.mockResolvedValue("denied");
    const response = await POST(request({ code: "123456" }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe(
      "誤入力の上限に達したため、一時的にロックされました"
    );
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "contact-1" },
      data: { smsAttemptCount: 5, smsStatus: "locked" },
    });
  });

  it("コード期限切れ(expired)の場合、400でcode:expiredを返しDB更新しない", async () => {
    mocks.checkVerification.mockResolvedValue("expired");
    const response = await POST(request({ code: "123456" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "確認コードの有効期限が切れています。再送してください",
      code: "expired",
    });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("送信失敗(SmsDeliveryError)後、再試行すれば正常に検証できる", async () => {
    mocks.checkVerification.mockRejectedValueOnce(new SmsDeliveryError("Twilio API error"));
    const first = await POST(request({ code: "123456" }));
    expect(first.status).toBe(502);
    expect(mocks.update).not.toHaveBeenCalled();

    mocks.checkVerification.mockResolvedValueOnce("approved");
    const second = await POST(request({ code: "123456" }));
    expect(second.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });
});
