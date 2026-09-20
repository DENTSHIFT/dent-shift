import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  resolveConfig: vi.fn(),
  findFirst: vi.fn(),
  enqueue: vi.fn(),
}));

vi.mock("@/server/config/timerexWebhookConfig", () => ({
  resolveTimeRexWebhookConfigFromProcessEnv: mocks.resolveConfig,
}));
vi.mock("@/server/db/prismaClient", () => ({
  prisma: { clinic: { findFirst: mocks.findFirst } },
}));
vi.mock("@/server/db/integrationEventRepository", () => ({
  enqueueIntegrationEvent: mocks.enqueue,
}));

import { POST } from "@/app/api/webhooks/timerex/route";

function request(body: unknown, secretHeader?: string) {
  const headers = new Headers({ "content-type": "application/json" });
  if (secretHeader !== undefined) headers.set("x-timerex-webhook-secret", secretHeader);
  return new NextRequest("https://dent-shift.example.com/api/webhooks/timerex", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enqueue.mockResolvedValue(undefined);
});

describe("POST /api/webhooks/timerex", () => {
  it("シークレット未設定時は無効化(503)する", async () => {
    mocks.resolveConfig.mockReturnValue({ provider: "disabled" });
    const response = await POST(request({ email: "a@example.com", status: "booked" }, "anything"));
    expect(response.status).toBe(503);
  });

  it("シークレット不一致は401を返す", async () => {
    mocks.resolveConfig.mockReturnValue({ provider: "enabled", sharedSecret: "correct-secret" });
    const response = await POST(request({ email: "a@example.com", status: "booked" }, "wrong-secret"));
    expect(response.status).toBe(401);
  });

  it("該当医院がなければ200/ignoredを返し、再送を誘発しない", async () => {
    mocks.resolveConfig.mockReturnValue({ provider: "enabled", sharedSecret: "s" });
    mocks.findFirst.mockResolvedValue(null);
    const response = await POST(request({ email: "unknown@example.com", status: "booked" }, "s"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ignored" });
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("正しいシークレットとstatus=bookedでonline_consultation_bookedを同期する", async () => {
    mocks.resolveConfig.mockReturnValue({ provider: "enabled", sharedSecret: "s" });
    mocks.findFirst.mockResolvedValue({ id: "clinic_1", name: "テスト歯科", url: "https://clinic.example.com" });

    const response = await POST(request({ email: "a@example.com", status: "booked" }, "s"));

    expect(response.status).toBe(200);
    expect(mocks.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "online_consultation_booked", clinicId: "clinic_1" })
    );
  });

  it("不正なstatus値は400を返す", async () => {
    mocks.resolveConfig.mockReturnValue({ provider: "enabled", sharedSecret: "s" });
    const response = await POST(request({ email: "a@example.com", status: "cancelled" }, "s"));
    expect(response.status).toBe(400);
  });
});
