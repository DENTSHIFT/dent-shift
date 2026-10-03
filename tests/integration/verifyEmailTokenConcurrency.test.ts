import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { applyPrismaMigrationsToTestDatabase } from "../helpers/testDatabase";

/**
 * verifyEmailToken()の同時多重アクセス(2026-10-03修正、commit bbc0ec5/129f0b4)を、
 * モックではなく実際のPrisma Client + 実際の一時SQLite DBで検証する結合テスト。
 *
 * ユニットテスト(tests/unit/verifyEmailToken.test.ts)はupdateMany/findUniqueの戻り値を
 * 手で用意したモックで検証しているだけで、「本当にDBレベルで2つの同時リクエストが
 * 競合したときに、条件付きupdateManyが実際に1件にしかマッチしないか」は検証できていない。
 * このテストはNode内蔵sqliteで全マイグレーションを適用した使い捨てDBに対して
 * Promise.allで本物のverifyEmailToken()を2回同時に呼び、実DB上の最終状態
 * (emailVerifiedAtが1回だけ設定される・IntegrationEventがちょうど1行だけ作られる)を確認する。
 *
 * 外部送信は発生させない: SALESFORCE_PROVIDER未設定(=既定で"disabled")のため、
 * enqueueIntegrationEvent()はDBへのpending行作成までで、syncIntegrationEvent()は
 * 即座に"disabled"を返しネットワークには一切出ない(src/server/services/salesforceSync.ts)。
 */

let testDbDir: string;
let prisma: import("@prisma/client").PrismaClient;
let verifyEmailToken: typeof import("@/server/services/verifyEmailToken").verifyEmailToken;

beforeAll(async () => {
  const root = process.platform === "darwin" ? realpathSync("/tmp") : realpathSync(tmpdir());
  testDbDir = mkdtempSync(path.join(root, "dent-shift-verify-email-concurrency-"));
  const dbPath = path.join(testDbDir, "test.db");
  process.env.DATABASE_URL = `file:${dbPath}`;
  // 明示的にdisabledを指定し、どの環境で実行してもSalesforceへ実際に接続しないことを保証する。
  process.env.SALESFORCE_PROVIDER = "disabled";
  applyPrismaMigrationsToTestDatabase(dbPath);

  prisma = (await import("@/server/db/prismaClient")).prisma;
  ({ verifyEmailToken } = await import("@/server/services/verifyEmailToken"));
}, 60000);

afterAll(async () => {
  await prisma?.$disconnect();
  if (testDbDir) rmSync(testDbDir, { recursive: true, force: true });
});

const RAW_TOKEN = "concurrency-test-raw-token";
const TOKEN_HASH = createHash("sha256").update(RAW_TOKEN).digest("hex");

describe("verifyEmailToken: 実DBでの同時多重アクセス", () => {
  it("同一トークンへの2つの同時呼び出しは、片方だけverifiedになり、emailVerifiedAtは1回だけ設定され、連携イベントはちょうど1件だけ作られる", async () => {
    const clinic = await prisma.clinic.create({
      data: { name: "並行テスト歯科", url: "https://concurrency-test.example.com" },
    });
    const contact = await prisma.contact.create({
      data: {
        clinicId: clinic.id,
        email: "concurrency-owner@example.com",
        passwordHash: "x",
        registrationStep: "email",
        emailVerificationTokenHash: TOKEN_HASH,
        emailVerificationExpiresAt: new Date(Date.now() + 60_000),
      },
    });

    const [resultA, resultB] = await Promise.all([
      verifyEmailToken(RAW_TOKEN),
      verifyEmailToken(RAW_TOKEN),
    ]);

    const statuses = [resultA.status, resultB.status].sort();
    // 先着1件だけが"verified"、競合した側は"already_verified"(invalidにはならない)。
    expect(statuses).toEqual(["already_verified", "verified"]);
    expect(resultA.contactId).toBe(contact.id);
    expect(resultB.contactId).toBe(contact.id);

    const latest = await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } });
    expect(latest.emailVerifiedAt).not.toBeNull();
    expect(latest.emailVerificationTokenHash).toBeNull();
    expect(latest.emailVerificationExpiresAt).toBeNull();
    expect(latest.registrationStep).toBe("consent");

    const events = await prisma.integrationEvent.findMany({ where: { contactId: contact.id } });
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe("email_verified");
  });
});
