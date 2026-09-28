import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentOperator: vi.fn(),
  findMany: vi.fn(),
  recordAuditLog: vi.fn(),
}));

vi.mock("@/server/auth/operatorSession", () => ({ getCurrentOperator: mocks.getCurrentOperator }));
vi.mock("@/server/db/prismaClient", () => ({
  prisma: {
    integrationEvent: {
      findMany: mocks.findMany,
    },
  },
}));
vi.mock("@/server/db/auditLogRepository", () => ({ recordAuditLog: mocks.recordAuditLog }));

import { GET } from "@/app/api/ops/integration-events/export/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.recordAuditLog.mockResolvedValue(undefined);
});

describe("GET /api/ops/integration-events/export", () => {
  it("未ログインの場合は401を返し、DBを参照しない", async () => {
    mocks.getCurrentOperator.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("admin以外のOperator(cs/analyst/finance)は403で拒否され、DBを参照しない", async () => {
    mocks.getCurrentOperator.mockResolvedValue({ id: "op-1", email: "ops@example.com", role: "cs" });

    const response = await GET();

    expect(response.status).toBe(403);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("adminはpending/failedのみを抽出するクエリを発行し、監査ログを記録する", async () => {
    mocks.getCurrentOperator.mockResolvedValue({ id: "op-1", email: "ops@example.com", role: "admin" });
    mocks.findMany.mockResolvedValue([]);

    await GET();

    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: { in: ["pending", "failed"] } },
      })
    );
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        operatorId: "op-1",
        action: "integration_events.export_csv",
        targetType: "IntegrationEvent",
        metadata: { exportedCount: 0 },
      })
    );
  });

  it("CSVはUTF-8 BOM付き・no-store・text/csvで返り、Salesforce取り込み用の実値(メール等)を含む", async () => {
    mocks.getCurrentOperator.mockResolvedValue({ id: "op-1", email: "ops@example.com", role: "admin" });
    mocks.findMany.mockResolvedValue([
      {
        id: "evt_1",
        eventType: "diagnosis_completed",
        status: "failed",
        retryCount: 8,
        lastError: "no_matchable_lead_identifier",
        clinicId: "clinic_1",
        contactId: null,
        createdAt: new Date("2026-09-29T00:00:00.000Z"),
        lastAttemptedAt: new Date("2026-09-29T00:05:00.000Z"),
        nextRetryAt: null,
        payloadJson: JSON.stringify({
          email: "real@example.com",
          clinic_name: "テスト歯科",
          director_name: "テスト院長",
          website_url: "https://example.com",
          utm_source: "instagram",
        }),
      },
    ]);

    const response = await GET();
    const buffer = new Uint8Array(await response.arrayBuffer());
    const text = new TextDecoder("utf-8").decode(buffer);

    expect(response.headers.get("Content-Type")).toContain("text/csv");
    expect(response.headers.get("Content-Disposition")).toContain("attachment");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(buffer[0]).toBe(0xef);
    expect(buffer[1]).toBe(0xbb);
    expect(buffer[2]).toBe(0xbf);
    // 実値(伏字化しない)で出力される。
    expect(text).toContain("real@example.com");
    expect(text).toContain("テスト歯科");
    expect(text).toContain("instagram");
    // 列は固定の最小セットであり、payload全体のJSON blobは出力しない。
    expect(text).not.toContain("{");
  });

  it("CSVインジェクション対策: =,+,-,@で始まる値(前後の空白を除いても該当する場合を含む)はシングルクォートを前置してエスケープする", async () => {
    mocks.getCurrentOperator.mockResolvedValue({ id: "op-1", email: "ops@example.com", role: "admin" });
    mocks.findMany.mockResolvedValue([
      {
        id: "evt_2",
        eventType: "diagnosis_completed",
        status: "failed",
        retryCount: 1,
        lastError: "=cmd|'/c calc'!A1",
        clinicId: "clinic_1",
        contactId: null,
        createdAt: new Date("2026-09-29T00:00:00.000Z"),
        lastAttemptedAt: null,
        nextRetryAt: null,
        payloadJson: JSON.stringify({ clinic_name: "  =SUM(1,2)" }),
      },
    ]);

    const response = await GET();
    const text = await response.text();

    expect(text).toContain("'=cmd|'/c calc'!A1");
    expect(text).toContain("'  =SUM(1,2)");
  });
});
