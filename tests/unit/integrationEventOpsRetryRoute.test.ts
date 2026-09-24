import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getCurrentOperator: vi.fn(),
  recordAuditLog: vi.fn(),
  getIntegrationEventByIdForOps: vi.fn(),
  reenqueueFailedIntegrationEvent: vi.fn(),
  syncIntegrationEvent: vi.fn(),
  resolveSalesforceConfigFromProcessEnv: vi.fn(),
}));

vi.mock("@/server/auth/operatorSession", () => ({ getCurrentOperator: mocks.getCurrentOperator }));
vi.mock("@/server/db/auditLogRepository", () => ({ recordAuditLog: mocks.recordAuditLog }));
vi.mock("@/server/db/integrationEventRepository", () => ({
  getIntegrationEventByIdForOps: mocks.getIntegrationEventByIdForOps,
  reenqueueFailedIntegrationEvent: mocks.reenqueueFailedIntegrationEvent,
}));
vi.mock("@/server/services/salesforceSync", () => ({ syncIntegrationEvent: mocks.syncIntegrationEvent }));
vi.mock("@/server/config/salesforceConfig", () => ({
  resolveSalesforceConfigFromProcessEnv: mocks.resolveSalesforceConfigFromProcessEnv,
}));

import { POST } from "@/app/api/ops/integration-events/[id]/retry/route";

function makeRequest() {
  return new NextRequest("https://ops.example.com/api/ops/integration-events/evt-1/retry", { method: "POST" });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentOperator.mockResolvedValue({ id: "operator-1", email: "ops@example.com", role: "admin" });
  mocks.recordAuditLog.mockResolvedValue(undefined);
  mocks.resolveSalesforceConfigFromProcessEnv.mockReturnValue({ provider: "disabled" });
  mocks.syncIntegrationEvent.mockResolvedValue(undefined);
});

describe("POST /api/ops/integration-events/[id]/retry", () => {
  it("未ログインの場合は401", async () => {
    mocks.getCurrentOperator.mockResolvedValue(null);
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "evt-1" }) });
    expect(res.status).toBe(401);
    expect(mocks.reenqueueFailedIntegrationEvent).not.toHaveBeenCalled();
  });

  it("イベントが存在しない場合は404", async () => {
    mocks.getIntegrationEventByIdForOps.mockResolvedValue(null);
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "evt-1" }) });
    expect(res.status).toBe(404);
  });

  it("synced状態のイベントは409で拒否し、再送処理を呼ばない", async () => {
    mocks.getIntegrationEventByIdForOps.mockResolvedValue({ id: "evt-1", status: "synced", eventType: "x", retryCount: 0 });
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "evt-1" }) });
    expect(res.status).toBe(409);
    expect(mocks.reenqueueFailedIntegrationEvent).not.toHaveBeenCalled();
  });

  it("pending状態のイベントも409で拒否する", async () => {
    mocks.getIntegrationEventByIdForOps.mockResolvedValue({ id: "evt-1", status: "pending", eventType: "x", retryCount: 0 });
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "evt-1" }) });
    expect(res.status).toBe(409);
  });

  it("failed状態のイベントは再送・監査ログ記録・即時同期を行う(Salesforce有効時)", async () => {
    mocks.getIntegrationEventByIdForOps.mockResolvedValue({ id: "evt-1", status: "failed", eventType: "diagnosis_completed", retryCount: 3 });
    mocks.reenqueueFailedIntegrationEvent.mockResolvedValue("reenqueued");
    mocks.resolveSalesforceConfigFromProcessEnv.mockReturnValue({ provider: "salesforce" });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "evt-1" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.salesforceDisabled).toBe(false);
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "ops_reenqueue_integration_event", targetId: "evt-1" })
    );
    expect(mocks.syncIntegrationEvent).toHaveBeenCalledWith("evt-1");
  });

  it("Salesforce disabled時は即時同期を呼ばず、案内メッセージを返す", async () => {
    mocks.getIntegrationEventByIdForOps.mockResolvedValue({ id: "evt-1", status: "failed", eventType: "diagnosis_completed", retryCount: 3 });
    mocks.reenqueueFailedIntegrationEvent.mockResolvedValue("reenqueued");
    mocks.resolveSalesforceConfigFromProcessEnv.mockReturnValue({ provider: "disabled" });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "evt-1" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.salesforceDisabled).toBe(true);
    expect(mocks.syncIntegrationEvent).not.toHaveBeenCalled();
  });

  it("where句ガードで対象外になった場合(二重実行)は409を返す", async () => {
    mocks.getIntegrationEventByIdForOps.mockResolvedValue({ id: "evt-1", status: "failed", eventType: "x", retryCount: 3 });
    mocks.reenqueueFailedIntegrationEvent.mockResolvedValue("not_failed_or_not_found");

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "evt-1" }) });
    expect(res.status).toBe(409);
    expect(mocks.syncIntegrationEvent).not.toHaveBeenCalled();
  });
});
