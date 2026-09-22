import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { applyPrismaMigrationsToTestDatabase } from "../helpers/testDatabase";

let testDbDir: string;
let repo: typeof import("@/server/db/improvementActionSelfServeRepository");
let prisma: import("@prisma/client").PrismaClient;

beforeAll(async () => {
  const testTmpRoot =
    process.platform === "darwin" ? realpathSync("/tmp") : realpathSync(tmpdir());
  testDbDir = mkdtempSync(path.join(testTmpRoot, "dent-shift-self-serve-test-db-"));
  const testDbPath = path.join(testDbDir, "test.db");
  process.env.DATABASE_URL = `file:${testDbPath}`;

  applyPrismaMigrationsToTestDatabase(testDbPath);

  repo = await import("@/server/db/improvementActionSelfServeRepository");
  const clientModule = await import("@/server/db/prismaClient");
  prisma = clientModule.prisma;
}, 60000);

afterAll(async () => {
  await prisma?.$disconnect();
  if (testDbDir) rmSync(testDbDir, { recursive: true, force: true });
});

async function createClinicWithDiagnosis(suffix: string) {
  const clinic = await prisma.clinic.create({
    data: { name: `テスト歯科${suffix}`, url: `https://example${suffix}.com` },
  });
  const diagnosis = await prisma.diagnosis.create({
    data: {
      clinicId: clinic.id,
      totalPoints: 50,
      totalStatus: "partial",
      scoreBreakdownJson: "{}",
      competitorsJson: "[]",
      questionResultsJson: "[]",
      improvementTasksJson: "[]",
      dataDisclaimer: "",
    },
  });
  return { clinic, diagnosis };
}

describe("ImprovementActionSelfServeRepository", () => {
  it("マークすると取得できる", async () => {
    const { clinic, diagnosis } = await createClinicWithDiagnosis("-mark");
    await repo.markImprovementActionSelfServe({
      clinicId: clinic.id,
      contactId: null,
      reportId: diagnosis.id,
      version: 1,
      improvementActionKey: "task-1",
    });

    const marks = await repo.getSelfServeMarksForReport({ reportId: diagnosis.id, version: 1 });
    expect(marks.has("task-1")).toBe(true);
  });

  it("同じキーへの再マークは冪等(重複行を作らない)", async () => {
    const { clinic, diagnosis } = await createClinicWithDiagnosis("-idempotent");
    await repo.markImprovementActionSelfServe({
      clinicId: clinic.id,
      contactId: null,
      reportId: diagnosis.id,
      version: 1,
      improvementActionKey: "task-1",
    });
    await repo.markImprovementActionSelfServe({
      clinicId: clinic.id,
      contactId: null,
      reportId: diagnosis.id,
      version: 1,
      improvementActionKey: "task-1",
    });

    const count = await prisma.improvementActionSelfServeMark.count({
      where: { reportId: diagnosis.id },
    });
    expect(count).toBe(1);
  });

  it("解除すると取得できなくなる", async () => {
    const { clinic, diagnosis } = await createClinicWithDiagnosis("-unmark");
    await repo.markImprovementActionSelfServe({
      clinicId: clinic.id,
      contactId: null,
      reportId: diagnosis.id,
      version: 1,
      improvementActionKey: "task-1",
    });
    await repo.unmarkImprovementActionSelfServe({
      reportId: diagnosis.id,
      version: 1,
      improvementActionKey: "task-1",
    });

    const marks = await repo.getSelfServeMarksForReport({ reportId: diagnosis.id, version: 1 });
    expect(marks.has("task-1")).toBe(false);
  });
});
