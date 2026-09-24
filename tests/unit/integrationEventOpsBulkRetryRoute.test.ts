import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getCurrentOperator: vi.fn(),
  recordAuditLog: vi.fn(),
  countIntegrationEventsForOps: vi.fn(),
  reenqueueFailedIntegrationEventsBulk: vi.fn(),
  syncIntegrationEvent: vi.fn(),
  resolveSalesforceConfigFromProcessEnv: vi.fn(),
}));

vi.mock("@/server/auth/operatorSession", () => ({ getCurrentOperator: mocks.getCurrentOperator }));
vi.mock("@/server/db/auditLogRepository", () => ({ recordAuditLog: mocks.recordAuditLog }));
vi.mock("@/server/db/integrationEventRepository", () => ({
  countIntegrationEventsForOps: mocks.countIntegrationEventsForOps,
  reenqueueFailedIntegrationEventsBulk: mocks.reenqueueFailedIntegrationEventsBulk,
  OPS_BULK_REENQUEUE_LIMIT: 100,
}));
vi.mock("@/server/services/salesforceSync", () => ({ syncIntegrationEvent: mocks.syncIntegrationEvent }));
vi.mock("@/server/config/salesforceConfig", () => ({
  resolveSalesforceConfigFromProcessEnv: mocks.resolveSalesforceConfigFromProcessEnv,
}));

import { POST } from "@/app/api/ops/integration-events/bulk-retry/route";

function request(body: Record<string, unknown>) {
  return new NextRequest("https://ops.example.com/api/ops/integration-events/bulk-retry", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentOperator.mockResolvedValue({ id: "operator-1", email: "ops@example.com", role: "admin" });
  mocks.recordAuditLog.mockResolvedValue(undefined);
  mocks.resolveSalesforceConfigFromProcessEnv.mockReturnValue({ provider: "disabled" });
  mocks.syncIntegrationEvent.mockResolvedValue(undefined);
});

describe("POST /api/ops/integration-events/bulk-retry", () => {
  it("未ログインの場合は401", async () => {
    mocks.getCurrentOperator.mockResolvedValue(null);
    const res = await POST(request({}));
    expect(res.status).toBe(401);
  });

  it("confirmなしの場合はプレビューのみ返し、DBを更新しない", async () => {
    mocks.countIntegrationEventsForOps.mockResolvedValue(42);
    const res = await POST(request({ eventType: "diagnosis_completed" }));
    const body = await res.json();

    expect(body.mode).toBe("preview");
    expect(body.matchedCount).toBe(42);
    expect(mocks.reenqueueFailedIntegrationEventsBulk).not.toHaveBeenCalled();
  });

  it("confirm:trueで実行し、監査ログを残す", async () => {
    mocks.countIntegrationEventsForOps.mockResolvedValue(3);
    mocks.reenqueueFailedIntegrationEventsBulk.mockResolvedValue({ matchedIds: ["a", "b", "c"], reenqueuedCount: 3 });
    mocks.resolveSalesforceConfigFromProcessEnv.mockReturnValue({ provider: "salesforce" });

    const res = await POST(request({ confirm: true }));
    const body = await res.json();

    expect(body.mode).toBe("executed");
    expect(body.reenqueuedCount).toBe(3);
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "ops_bulk_reenqueue_integration_events" })
    );
    expect(mocks.syncIntegrationEvent).toHaveBeenCalledTimes(3);
  });

  it("対象0件でconfirm:trueの場合は何もせず0件で返す", async () => {
    mocks.countIntegrationEventsForOps.mockResolvedValue(0);
    const res = await POST(request({ confirm: true }));
    const body = await res.json();

    expect(body.reenqueuedCount).toBe(0);
    expect(mocks.reenqueueFailedIntegrationEventsBulk).not.toHaveBeenCalled();
  });

  it("Salesforce disabled時は即時同期せず案内を返す", async () => {
    mocks.countIntegrationEventsForOps.mockResolvedValue(2);
    mocks.reenqueueFailedIntegrationEventsBulk.mockResolvedValue({ matchedIds: ["a", "b"], reenqueuedCount: 2 });
    mocks.resolveSalesforceConfigFromProcessEnv.mockReturnValue({ provider: "disabled" });

    const res = await POST(request({ confirm: true }));
    const body = await res.json();

    expect(body.salesforceDisabled).toBe(true);
    expect(mocks.syncIntegrationEvent).not.toHaveBeenCalled();
  });
});
