import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  enqueueIntegrationEvent: vi.fn(),
}));

vi.mock("@/server/db/integrationEventRepository", () => ({
  enqueueIntegrationEvent: mocks.enqueueIntegrationEvent,
}));

import { POST } from "@/app/api/events/diagnosis-started/route";

function request(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/events/diagnosis-started", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enqueueIntegrationEvent.mockResolvedValue(undefined);
});

/**
 * 2026-09-24: Instagram等の流入チャネル別に診断「開始」を匿名で記録する公開エンドポイント。
 * clinicId/diagnosisIdがまだ存在しない段階のため、UTM値(5項目)のみを受け付ける。
 */
describe("POST /api/events/diagnosis-started", () => {
  it("UTM5項目を渡すとdiagnosis_startedイベントがclinicId:nullで積まれる", async () => {
    const res = await POST(
      request({
        utmSource: "instagram",
        utmMedium: "profile",
        utmCampaign: "launch",
        utmContent: "bio-link",
        utmTerm: "ai-diagnosis",
      })
    );
    expect(res.status).toBe(204);
    expect(mocks.enqueueIntegrationEvent).toHaveBeenCalledWith({
      eventType: "diagnosis_started",
      clinicId: null,
      payload: {
        utm_source: "instagram",
        utm_medium: "profile",
        utm_campaign: "launch",
        utm_content: "bio-link",
        utm_term: "ai-diagnosis",
      },
    });
  });

  it("UTM値が無い場合は5項目ともnullで記録される(直接流入・既存LP経由)", async () => {
    const res = await POST(request({}));
    expect(res.status).toBe(204);
    expect(mocks.enqueueIntegrationEvent).toHaveBeenCalledWith({
      eventType: "diagnosis_started",
      clinicId: null,
      payload: {
        utm_source: null,
        utm_medium: null,
        utm_campaign: null,
        utm_content: null,
        utm_term: null,
      },
    });
  });

  it("不正な型(数値等)のUTM値はnullとして扱う", async () => {
    await POST(request({ utmSource: 12345, utmMedium: null, utmCampaign: { a: 1 } }));
    expect(mocks.enqueueIntegrationEvent).toHaveBeenCalledWith({
      eventType: "diagnosis_started",
      clinicId: null,
      payload: {
        utm_source: null,
        utm_medium: null,
        utm_campaign: null,
        utm_content: null,
        utm_term: null,
      },
    });
  });

  it("101文字以上のUTM値はnullになる(部分的に切り詰めない)", async () => {
    const long = "a".repeat(200);
    await POST(request({ utmSource: long }));
    const call = mocks.enqueueIntegrationEvent.mock.calls[0]?.[0];
    expect(call?.payload.utm_source).toBeNull();
  });

  it("許可外の文字種(スペース・日本語等)を含むUTM値はnullになる", async () => {
    await POST(request({ utmSource: "instagram post", utmMedium: "インスタ" }));
    const call = mocks.enqueueIntegrationEvent.mock.calls[0]?.[0];
    expect(call?.payload.utm_source).toBeNull();
    expect(call?.payload.utm_medium).toBeNull();
  });

  it("不正なJSONボディの場合は400を返し、イベントを積まない", async () => {
    const req = new NextRequest("http://localhost/api/events/diagnosis-started", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(mocks.enqueueIntegrationEvent).not.toHaveBeenCalled();
  });

  it("enqueueIntegrationEventが例外を投げても204を返す(計測失敗でフォーム利用を止めない)", async () => {
    mocks.enqueueIntegrationEvent.mockRejectedValue(new Error("db down"));
    const res = await POST(request({ utmSource: "instagram" }));
    expect(res.status).toBe(204);
  });
});
