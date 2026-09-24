import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { applyPrismaMigrationsToTestDatabase } from "../helpers/testDatabase";

/**
 * 2026-09-24: ops再送管理画面が使う一覧・再送用リポジトリ関数を、実SQLite DBに対して
 * 検証する結合テスト。「synced/pendingを誤って再送しない」「retryCount=8到達イベントも
 * 対象に含む」「一括再送は事前に確定したID一覧のみを更新する」ことが核心の安全要件。
 */

let testDbDir: string;
let repo: typeof import("@/server/db/integrationEventRepository");
let prisma: import("@prisma/client").PrismaClient;

beforeAll(async () => {
  const testTmpRoot =
    process.platform === "darwin" ? realpathSync("/tmp") : realpathSync(tmpdir());
  testDbDir = mkdtempSync(path.join(testTmpRoot, "dent-shift-integration-event-ops-test-db-"));
  const testDbPath = path.join(testDbDir, "test.db");
  process.env.DATABASE_URL = `file:${testDbPath}`;
  process.env.SALESFORCE_PROVIDER = "disabled";

  applyPrismaMigrationsToTestDatabase(testDbPath);

  repo = await import("@/server/db/integrationEventRepository");
  const clientModule = await import("@/server/db/prismaClient");
  prisma = clientModule.prisma;
}, 60000);

afterAll(async () => {
  await prisma?.$disconnect();
  if (testDbDir) rmSync(testDbDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await prisma.integrationEvent.deleteMany();
});

async function createEvent(overrides: Partial<{
  eventType: string;
  status: string;
  retryCount: number;
  clinicId: string | null;
}> = {}) {
  return prisma.integrationEvent.create({
    data: {
      eventType: overrides.eventType ?? "diagnosis_completed",
      status: overrides.status ?? "failed",
      retryCount: overrides.retryCount ?? 1,
      clinicId: overrides.clinicId ?? "clinic-1",
      payloadJson: JSON.stringify({ email: "owner@example.com", clinic_name: "テスト歯科" }),
    },
  });
}

describe("listIntegrationEventsForOps", () => {
  it("ステータス・retryExhaustedOnly・clinicIdで絞り込める", async () => {
    await createEvent({ status: "failed", retryCount: 8, clinicId: "clinic-a" });
    await createEvent({ status: "failed", retryCount: 1, clinicId: "clinic-a" });
    await createEvent({ status: "pending", retryCount: 0, clinicId: "clinic-b" });
    await createEvent({ status: "synced", retryCount: 0, clinicId: "clinic-a" });

    const failedOnly = await repo.listIntegrationEventsForOps({ status: "failed" }, 1);
    expect(failedOnly.total).toBe(2);

    const exhaustedOnly = await repo.listIntegrationEventsForOps({ retryExhaustedOnly: true }, 1);
    expect(exhaustedOnly.total).toBe(1);
    expect(exhaustedOnly.items[0]?.retryCount).toBe(8);

    const byClinic = await repo.listIntegrationEventsForOps({ clinicId: "clinic-b" }, 1);
    expect(byClinic.total).toBe(1);
    expect(byClinic.items[0]?.status).toBe("pending");
  });

  it("ページネーションが機能する", async () => {
    for (let i = 0; i < 5; i++) {
      await createEvent({ status: "failed" });
    }
    const page1 = await repo.listIntegrationEventsForOps({ status: "failed" }, 1);
    expect(page1.total).toBe(5);
    expect(page1.pageSize).toBeGreaterThanOrEqual(5);
  });
});

describe("reenqueueFailedIntegrationEvent: 個別再送のガード", () => {
  it("failed状態のイベントはpendingへ戻り、retryCountが0にリセットされる", async () => {
    const event = await createEvent({ status: "failed", retryCount: 5 });
    const result = await repo.reenqueueFailedIntegrationEvent(event.id);
    expect(result).toBe("reenqueued");

    const updated = await prisma.integrationEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(updated.status).toBe("pending");
    expect(updated.retryCount).toBe(0);
  });

  it("retryCount=8(上限到達)のイベントも再送対象にできる", async () => {
    const event = await createEvent({ status: "failed", retryCount: 8 });
    const result = await repo.reenqueueFailedIntegrationEvent(event.id);
    expect(result).toBe("reenqueued");
  });

  it("synced状態のイベントは誤って再送されない", async () => {
    const event = await createEvent({ status: "synced", retryCount: 0 });
    const result = await repo.reenqueueFailedIntegrationEvent(event.id);
    expect(result).toBe("not_failed_or_not_found");

    const unchanged = await prisma.integrationEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(unchanged.status).toBe("synced");
  });

  it("pending状態のイベントは再送対象にならない(すでに保留中のため)", async () => {
    const event = await createEvent({ status: "pending", retryCount: 0 });
    const result = await repo.reenqueueFailedIntegrationEvent(event.id);
    expect(result).toBe("not_failed_or_not_found");
  });

  it("存在しないIDを指定した場合はnot_failed_or_not_foundを返す", async () => {
    const result = await repo.reenqueueFailedIntegrationEvent("does-not-exist");
    expect(result).toBe("not_failed_or_not_found");
  });

  it("2回連続で同じイベントを再送しようとしても、2回目は失敗する(二重実行防止)", async () => {
    const event = await createEvent({ status: "failed", retryCount: 3 });
    const first = await repo.reenqueueFailedIntegrationEvent(event.id);
    const second = await repo.reenqueueFailedIntegrationEvent(event.id);
    expect(first).toBe("reenqueued");
    expect(second).toBe("not_failed_or_not_found");
  });
});

describe("reenqueueFailedIntegrationEventsBulk: 一括再送の安全性", () => {
  it("条件に一致するfailedイベントのみを対象にする(synced/pendingは含まない)", async () => {
    const failed1 = await createEvent({ status: "failed", clinicId: "clinic-a" });
    const failed2 = await createEvent({ status: "failed", clinicId: "clinic-a" });
    await createEvent({ status: "synced", clinicId: "clinic-a" });
    await createEvent({ status: "pending", clinicId: "clinic-a" });
    await createEvent({ status: "failed", clinicId: "clinic-b" });

    const { matchedIds, reenqueuedCount } = await repo.reenqueueFailedIntegrationEventsBulk({ clinicId: "clinic-a" });
    expect(reenqueuedCount).toBe(2);
    expect(matchedIds.sort()).toEqual([failed1.id, failed2.id].sort());

    const stillFailedOther = await prisma.integrationEvent.findFirst({ where: { clinicId: "clinic-b" } });
    expect(stillFailedOther?.status).toBe("failed");
  });

  it("1回あたりの上限件数を超えない", async () => {
    for (let i = 0; i < 5; i++) {
      await createEvent({ status: "failed" });
    }
    const { reenqueuedCount } = await repo.reenqueueFailedIntegrationEventsBulk({}, 3);
    expect(reenqueuedCount).toBe(3);

    const remainingFailed = await prisma.integrationEvent.count({ where: { status: "failed" } });
    expect(remainingFailed).toBe(2);
  });

  it("条件に一致するfailedイベントが0件の場合は何も更新しない", async () => {
    await createEvent({ status: "synced" });
    const { matchedIds, reenqueuedCount } = await repo.reenqueueFailedIntegrationEventsBulk({});
    expect(matchedIds).toEqual([]);
    expect(reenqueuedCount).toBe(0);
  });

  it("retryExhaustedOnlyで絞り込んだ一括再送は、上限到達分だけを対象にする", async () => {
    await createEvent({ status: "failed", retryCount: 8 });
    await createEvent({ status: "failed", retryCount: 2 });
    const { reenqueuedCount } = await repo.reenqueueFailedIntegrationEventsBulk({ retryExhaustedOnly: true });
    expect(reenqueuedCount).toBe(1);
  });
});
