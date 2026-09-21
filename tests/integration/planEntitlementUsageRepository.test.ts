import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { applyPrismaMigrationsToTestDatabase } from "../helpers/testDatabase";

/**
 * PlanEntitlementUsageの無料枠消費が実DB(SQLite)レベルで原子的であることを確認する。
 * 同時リクエストでの二重消費防止(仕様書Ver1■)が本命の検証対象。
 */

let testDbDir: string;
let repo: typeof import("@/server/db/planEntitlementUsageRepository");
let prisma: import("@prisma/client").PrismaClient;

beforeAll(async () => {
  const testTmpRoot =
    process.platform === "darwin" ? realpathSync("/tmp") : realpathSync(tmpdir());
  testDbDir = mkdtempSync(path.join(testTmpRoot, "dent-shift-entitlement-test-db-"));
  const testDbPath = path.join(testDbDir, "test.db");
  process.env.DATABASE_URL = `file:${testDbPath}`;

  applyPrismaMigrationsToTestDatabase(testDbPath);

  repo = await import("@/server/db/planEntitlementUsageRepository");
  const clientModule = await import("@/server/db/prismaClient");
  prisma = clientModule.prisma;
}, 60000);

afterAll(async () => {
  await prisma?.$disconnect();
  if (testDbDir) rmSync(testDbDir, { recursive: true, force: true });
});

async function createClinic(suffix: string) {
  return prisma.clinic.create({
    data: { name: `テスト歯科${suffix}`, url: `https://example${suffix}.com` },
  });
}

describe("PlanEntitlementUsageRepository: 無料枠の原子的消費", () => {
  it("includedQuantity分までは消費でき、それ以降はfalseになる(スタンダード相当:1件)", async () => {
    const clinic = await createClinic("-standard");
    const period = "2026-09";

    const first = await prisma.$transaction((tx) =>
      repo.tryConsumeEntitlement(tx, {
        clinicId: clinic.id,
        entitlementKey: "instruction_pdf_monthly",
        period,
        includedQuantity: 1,
      })
    );
    expect(first).toBe(true);

    const second = await prisma.$transaction((tx) =>
      repo.tryConsumeEntitlement(tx, {
        clinicId: clinic.id,
        entitlementKey: "instruction_pdf_monthly",
        period,
        includedQuantity: 1,
      })
    );
    expect(second).toBe(false);

    const usage = await repo.getEntitlementUsage({
      clinicId: clinic.id,
      entitlementKey: "instruction_pdf_monthly",
      period,
    });
    expect(usage?.usedQuantity).toBe(1);
    expect(usage?.includedQuantity).toBe(1);
  });

  it("includedQuantity=0(ライト相当)は常にfalseで、行も作成しない", async () => {
    const clinic = await createClinic("-light");
    const consumed = await prisma.$transaction((tx) =>
      repo.tryConsumeEntitlement(tx, {
        clinicId: clinic.id,
        entitlementKey: "instruction_pdf_monthly",
        period: "2026-09",
        includedQuantity: 0,
      })
    );
    expect(consumed).toBe(false);
    const usage = await repo.getEntitlementUsage({
      clinicId: clinic.id,
      entitlementKey: "instruction_pdf_monthly",
      period: "2026-09",
    });
    expect(usage).toBeNull();
  });

  it("同時実行(Promise.all)でも、3件枠(プレミアム相当)に対して3回しか消費が成功しない", async () => {
    const clinic = await createClinic("-premium-concurrent");
    const period = "2026-09";

    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        prisma.$transaction((tx) =>
          repo.tryConsumeEntitlement(tx, {
            clinicId: clinic.id,
            entitlementKey: "instruction_pdf_monthly",
            period,
            includedQuantity: 3,
          })
        )
      )
    );

    const successCount = results.filter((r) => r === true).length;
    expect(successCount).toBe(3);

    const usage = await repo.getEntitlementUsage({
      clinicId: clinic.id,
      entitlementKey: "instruction_pdf_monthly",
      period,
    });
    expect(usage?.usedQuantity).toBe(3);
  });

  it("月(period)が変わると別枠として扱われる", async () => {
    const clinic = await createClinic("-period-rollover");

    const septConsumed = await prisma.$transaction((tx) =>
      repo.tryConsumeEntitlement(tx, {
        clinicId: clinic.id,
        entitlementKey: "instruction_pdf_monthly",
        period: "2026-09",
        includedQuantity: 1,
      })
    );
    expect(septConsumed).toBe(true);

    const octConsumed = await prisma.$transaction((tx) =>
      repo.tryConsumeEntitlement(tx, {
        clinicId: clinic.id,
        entitlementKey: "instruction_pdf_monthly",
        period: "2026-10",
        includedQuantity: 1,
      })
    );
    expect(octConsumed).toBe(true);
  });
});
