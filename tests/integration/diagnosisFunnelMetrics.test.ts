import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { applyPrismaMigrationsToTestDatabase } from "../helpers/testDatabase";

/**
 * 2026-09-24: 運用者が診断「開始→完了→相談CTAクリック」の件数をUTM流入元別に
 * 確認できるようにするための集計関数。Salesforce同期状態(status)とは無関係に、
 * イベント発生自体(eventType)を数えることを確認する。
 */

let testDbDir: string;
let prisma: import("@prisma/client").PrismaClient;
let getDiagnosisFunnelMetrics: typeof import("@/server/db/integrationEventMetrics").getDiagnosisFunnelMetrics;

beforeAll(async () => {
  const testTmpRoot =
    process.platform === "darwin" ? realpathSync("/tmp") : realpathSync(tmpdir());
  testDbDir = mkdtempSync(path.join(testTmpRoot, "dent-shift-funnel-metrics-test-db-"));
  const testDbPath = path.join(testDbDir, "test.db");
  process.env.DATABASE_URL = `file:${testDbPath}`;

  applyPrismaMigrationsToTestDatabase(testDbPath);

  const clientModule = await import("@/server/db/prismaClient");
  prisma = clientModule.prisma;
  ({ getDiagnosisFunnelMetrics } = await import("@/server/db/integrationEventMetrics"));
}, 60000);

afterAll(async () => {
  await prisma?.$disconnect();
  if (testDbDir) rmSync(testDbDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await prisma.integrationEvent.deleteMany();
});

async function createEvent(
  eventType: string,
  payload: Record<string, unknown>,
  overrides: { status?: string; createdAt?: Date } = {}
) {
  return prisma.integrationEvent.create({
    data: {
      eventType,
      payloadJson: JSON.stringify(payload),
      status: overrides.status ?? "pending",
      createdAt: overrides.createdAt ?? new Date(),
    },
  });
}

const RANGE = { from: new Date("2020-01-01"), to: new Date("2030-01-01") };

describe("getDiagnosisFunnelMetrics", () => {
  it("Salesforce同期が失敗(pending)のままでも、イベント発生自体は正しく数える", async () => {
    await createEvent("diagnosis_started", { utm_source: "instagram" }, { status: "pending" });
    await createEvent("diagnosis_completed", { utm_source: "instagram" }, { status: "failed" });
    await createEvent("online_consultation_clicked", { utm_source: "instagram" }, { status: "pending" });

    const metrics = await getDiagnosisFunnelMetrics(RANGE);
    expect(metrics.started).toBe(1);
    expect(metrics.completed).toBe(1);
    expect(metrics.consultationClicked).toBe(1);
  });

  it("utm_sourceごとに内訳を集計する", async () => {
    await createEvent("diagnosis_started", { utm_source: "instagram" });
    await createEvent("diagnosis_started", { utm_source: "instagram" });
    await createEvent("diagnosis_completed", { utm_source: "instagram" });
    await createEvent("diagnosis_started", { utm_source: "google" });

    const metrics = await getDiagnosisFunnelMetrics(RANGE);
    expect(metrics.byUtmSource.instagram).toEqual({ started: 2, completed: 1, consultationClicked: 0 });
    expect(metrics.byUtmSource.google).toEqual({ started: 1, completed: 0, consultationClicked: 0 });
  });

  it("utm_sourceが無いイベントはunattributedCountに計上し、byUtmSourceには含めない", async () => {
    await createEvent("diagnosis_started", {});
    await createEvent("diagnosis_started", { utm_source: null });

    const metrics = await getDiagnosisFunnelMetrics(RANGE);
    expect(metrics.unattributedCount).toBe(2);
    expect(metrics.started).toBe(2);
    expect(Object.keys(metrics.byUtmSource)).toHaveLength(0);
  });

  it("対象期間外のイベントは集計しない", async () => {
    await createEvent(
      "diagnosis_started",
      { utm_source: "instagram" },
      { createdAt: new Date("2019-01-01") }
    );
    const metrics = await getDiagnosisFunnelMetrics(RANGE);
    expect(metrics.started).toBe(0);
    expect(metrics.totalEventsScanned).toBe(0);
  });

  it("diagnosis_started/completed/online_consultation_clicked以外のイベント種別は含めない", async () => {
    await createEvent("email_verified", { utm_source: "instagram" });
    const metrics = await getDiagnosisFunnelMetrics(RANGE);
    expect(metrics.totalEventsScanned).toBe(0);
  });

  it("壊れたJSONのpayloadでも例外を投げず、unattributedとして扱う", async () => {
    await prisma.integrationEvent.create({
      data: { eventType: "diagnosis_started", payloadJson: "not json", status: "pending" },
    });
    const metrics = await getDiagnosisFunnelMetrics(RANGE);
    expect(metrics.started).toBe(1);
    expect(metrics.unattributedCount).toBe(1);
  });
});
