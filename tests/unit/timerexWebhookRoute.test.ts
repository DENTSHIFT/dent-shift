import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  resolveConfig: vi.fn(),
  applyBooking: vi.fn(),
}));

vi.mock("@/server/config/timerexWebhookConfig", () => ({
  resolveTimeRexWebhookConfigFromProcessEnv: mocks.resolveConfig,
}));
vi.mock("@/server/services/timerexBookings", () => ({
  applyTimeRexBooking: mocks.applyBooking,
}));

import { POST } from "@/app/api/webhooks/timerex/route";

// TimeRex公式リファレンスの例(event_confirmed)を簡略化したもの。
function confirmedPayload(overrides: Record<string, unknown> = {}) {
  return {
    webhook_type: "event_confirmed",
    calendar_name: "45分相談",
    event: {
      id: "1981d18a994f60e7bcc2",
      status: 1,
      start_datetime: "2026-10-10T01:00:00+00:00",
      end_datetime: "2026-10-10T01:45:00+00:00",
      created_at: "2026-10-02T02:22:40+00:00",
      hosts: [{ name: "担当A", email: "host@example.com" }],
      form: [
        { field_type: "guest_name", value: "院長 テスト" },
        { field_type: "guest_email", value: "owner@example-dental.jp" },
      ],
      url_params: [{ utm_source: "result" }, { ds_ref: "clinic_1.sig" }],
      ...overrides,
    },
  };
}

function request(body: unknown, token?: string) {
  const headers = new Headers({ "content-type": "application/json" });
  if (token !== undefined) headers.set("x-timerex-authorization", token);
  return new NextRequest("https://dent-shift.example.com/api/webhooks/timerex", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveConfig.mockReturnValue({ provider: "enabled", sharedSecret: "correct-token" });
  mocks.applyBooking.mockResolvedValue({ outcome: "recorded", matchMethod: "signed_ref" });
});

describe("POST /api/webhooks/timerex", () => {
  it("セキュリティトークン未設定時は無効化(503)する", async () => {
    mocks.resolveConfig.mockReturnValue({ provider: "disabled" });
    const response = await POST(request(confirmedPayload(), "anything"));
    expect(response.status).toBe(503);
  });

  it("x-timerex-authorizationが一致しない場合は401で、何も保存しない", async () => {
    expect((await POST(request(confirmedPayload(), "wrong-token"))).status).toBe(401);
    expect((await POST(request(confirmedPayload()))).status).toBe(401);
    expect(mocks.applyBooking).not.toHaveBeenCalled();
  });

  it("予約成立(event_confirmed)を予約ID・日時・担当・url_paramsとともに保存する(ゲスト氏名は渡さない)", async () => {
    const response = await POST(request(confirmedPayload(), "correct-token"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "recorded", matched: true });
    const [notice] = mocks.applyBooking.mock.calls[0]!;
    expect(notice).toEqual({
      webhookType: "event_confirmed",
      timerexEventId: "1981d18a994f60e7bcc2",
      startAt: new Date("2026-10-10T01:00:00Z"),
      endAt: new Date("2026-10-10T01:45:00Z"),
      bookedAt: new Date("2026-10-02T02:22:40Z"),
      canceledAt: null,
      calendarName: "45分相談",
      hostName: "担当A",
      guestEmail: "owner@example-dental.jp",
      urlParams: { utm_source: "result", ds_ref: "clinic_1.sig" },
    });
    expect(JSON.stringify(notice)).not.toContain("院長 テスト");
  });

  it("キャンセル(event_cancelled)はキャンセル日時とともに保存する", async () => {
    const payload = confirmedPayload({ status: 3, canceled_at: "2026-10-05T00:00:00+00:00", url_params: undefined });
    payload.webhook_type = "event_cancelled";

    await POST(request(payload, "correct-token"));

    const [notice] = mocks.applyBooking.mock.calls[0]!;
    expect(notice.webhookType).toBe("event_cancelled");
    expect(notice.canceledAt).toEqual(new Date("2026-10-05T00:00:00Z"));
    expect(notice.urlParams).toEqual({});
  });

  it("未対応の通知種別は200/ignoredで再送させない", async () => {
    const response = await POST(request({ webhook_type: "something_else", event: {} }, "correct-token"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ignored" });
    expect(mocks.applyBooking).not.toHaveBeenCalled();
  });

  it("予約ID・日時が欠けた通知は400", async () => {
    const response = await POST(request(confirmedPayload({ id: undefined }), "correct-token"));
    expect(response.status).toBe(400);
    expect(mocks.applyBooking).not.toHaveBeenCalled();
  });

  it("医院を特定できない予約も保存し(運用画面で確認)、200を返す", async () => {
    mocks.applyBooking.mockResolvedValue({ outcome: "recorded", matchMethod: "unmatched" });
    const response = await POST(request(confirmedPayload(), "correct-token"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "recorded", matched: false });
  });
});
