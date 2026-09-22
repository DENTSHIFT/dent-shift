import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { applyPrismaMigrationsToTestDatabase } from "../helpers/testDatabase";

let testDbDir: string;
let repo: typeof import("@/server/db/inviteRepository");
let prisma: import("@prisma/client").PrismaClient;

beforeAll(async () => {
  const testTmpRoot =
    process.platform === "darwin" ? realpathSync("/tmp") : realpathSync(tmpdir());
  testDbDir = mkdtempSync(path.join(testTmpRoot, "dent-shift-invite-test-db-"));
  const testDbPath = path.join(testDbDir, "test.db");
  process.env.DATABASE_URL = `file:${testDbPath}`;

  applyPrismaMigrationsToTestDatabase(testDbPath);

  repo = await import("@/server/db/inviteRepository");
  const clientModule = await import("@/server/db/prismaClient");
  prisma = clientModule.prisma;
}, 60000);

afterAll(async () => {
  await prisma?.$disconnect();
  if (testDbDir) rmSync(testDbDir, { recursive: true, force: true });
});

async function createContact(suffix: string) {
  const clinic = await prisma.clinic.create({
    data: { name: `招待先テスト歯科${suffix}`, url: `https://invite-test${suffix}.example.com` },
  });
  return prisma.contact.create({
    data: {
      clinicId: clinic.id,
      email: `invitee${suffix}@example.com`,
      passwordHash: "hash",
    },
  });
}

describe("InviteRepository: createInvite / getInviteByCode", () => {
  it("作成した招待をinviteCodeで取得でき、コードは推測困難な長さを持つ", async () => {
    const invite = await repo.createInvite({
      clinicName: "サンプル知人歯科",
      email: "owner@example.com",
      stripePriceId: "price_test_invite",
    });
    expect(invite.inviteCode.length).toBeGreaterThanOrEqual(20);
    expect(invite.specialPriceJpy).toBe(1);
    expect(invite.durationMonths).toBe(3);
    expect(invite.status).toBe("active");

    const found = await repo.getInviteByCode(invite.inviteCode);
    expect(found?.id).toBe(invite.id);
  });
});

describe("InviteRepository: tryConsumeInvite(原子的な二重消費防止)", () => {
  it("maxUses=1の招待は1回だけ消費でき、statusがusedへ変わる", async () => {
    const invite = await repo.createInvite({
      clinicName: "サンプル知人歯科2",
      email: "owner2@example.com",
      stripePriceId: "price_test_invite",
      maxUses: 1,
    });
    const contact = await createContact("-single-use");

    const first = await prisma.$transaction((tx) =>
      repo.tryConsumeInvite(tx, { inviteId: invite.id, contactId: contact.id })
    );
    expect(first).toBe(true);

    const afterFirst = await repo.getInviteById(invite.id);
    expect(afterFirst?.usedCount).toBe(1);
    expect(afterFirst?.status).toBe("used");
    expect(afterFirst?.usedByContactId).toBe(contact.id);

    const second = await prisma.$transaction((tx) =>
      repo.tryConsumeInvite(tx, { inviteId: invite.id, contactId: contact.id })
    );
    expect(second).toBe(false);
  });

  it("同時実行(Promise.all)でも、maxUses分しか消費が成功しない", async () => {
    const invite = await repo.createInvite({
      clinicName: "サンプル知人歯科3",
      email: "owner3@example.com",
      stripePriceId: "price_test_invite",
      maxUses: 3,
    });
    const contacts = await Promise.all(
      Array.from({ length: 6 }, (_, i) => createContact(`-concurrent-${i}`))
    );

    const results = await Promise.all(
      contacts.map((contact) =>
        prisma.$transaction((tx) => repo.tryConsumeInvite(tx, { inviteId: invite.id, contactId: contact.id }))
      )
    );

    expect(results.filter((r) => r === true)).toHaveLength(3);
    const finalInvite = await repo.getInviteById(invite.id);
    expect(finalInvite?.usedCount).toBe(3);
    expect(finalInvite?.status).toBe("used");
  });

  it("存在しない招待IDはfalse", async () => {
    const contact = await createContact("-missing-invite");
    const result = await prisma.$transaction((tx) =>
      repo.tryConsumeInvite(tx, { inviteId: "does-not-exist", contactId: contact.id })
    );
    expect(result).toBe(false);
  });
});
