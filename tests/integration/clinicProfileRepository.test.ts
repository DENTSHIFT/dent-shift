import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { applyPrismaMigrationsToTestDatabase } from "../helpers/testDatabase";

vi.mock("server-only", () => ({}));

let testDbDir: string;
let repo: typeof import("@/server/db/clinicProfileRepository");
let prisma: import("@prisma/client").PrismaClient;

beforeAll(async () => {
  const root = process.platform === "darwin" ? realpathSync("/tmp") : realpathSync(tmpdir());
  testDbDir = mkdtempSync(path.join(root, "dent-shift-clinic-profile-test-db-"));
  const dbPath = path.join(testDbDir, "test.db");
  process.env.DATABASE_URL = `file:${dbPath}`;
  applyPrismaMigrationsToTestDatabase(dbPath);
  repo = await import("@/server/db/clinicProfileRepository");
  prisma = (await import("@/server/db/prismaClient")).prisma;
}, 60000);

afterAll(async () => {
  await prisma?.$disconnect();
  if (testDbDir) rmSync(testDbDir, { recursive: true, force: true });
});

const values = (over: Record<string, string | null> = {}) => ({
  name: "更新後歯科",
  directorName: null,
  url: "https://after.example.com",
  gbpUrl: null,
  bookingUrl: null,
  contactPhone: "03-1234-5678",
  ...over,
});

describe("updateClinicProfile", () => {
  it("自院だけを更新し、他院は変更せず、監査ログには項目名のみを残す", async () => {
    const a = await prisma.clinic.create({ data: { name: "A歯科", url: "https://a.example.com" } });
    const b = await prisma.clinic.create({ data: { name: "B歯科", url: "https://b.example.com" } });
    const contact = await prisma.contact.create({
      data: { clinicId: a.id, email: "profile-a@example.com", passwordHash: "x" },
    });

    const result = await repo.updateClinicProfile({ clinicId: a.id, contactId: contact.id, values: values() });
    expect(result?.changed).toEqual(["name", "url", "contactPhone"]);

    expect((await repo.getClinicProfile(a.id))?.name).toBe("更新後歯科");
    expect((await repo.getClinicProfile(b.id))?.name).toBe("B歯科");

    const logs = await prisma.clinicAuditLog.findMany({ where: { clinicId: a.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0]!.action).toBe("clinic_profile_updated");
    expect(logs[0]!.metadataJson).toBe(JSON.stringify({ fields: ["name", "url", "contactPhone"] }));
    expect(logs[0]!.metadataJson).not.toContain("03-1234");
    expect(await prisma.clinicAuditLog.count({ where: { clinicId: b.id } })).toBe(0);
  });

  it("変更がなければ更新も監査ログも作らず、存在しない医院はnull", async () => {
    const c = await prisma.clinic.create({ data: { name: "C歯科", url: "https://c.example.com" } });
    const contact = await prisma.contact.create({
      data: { clinicId: c.id, email: "profile-c@example.com", passwordHash: "x" },
    });
    const same = values({ name: "C歯科", url: "https://c.example.com", contactPhone: null });
    expect((await repo.updateClinicProfile({ clinicId: c.id, contactId: contact.id, values: same }))?.changed).toEqual([]);
    expect(await prisma.clinicAuditLog.count({ where: { clinicId: c.id } })).toBe(0);
    expect(await repo.updateClinicProfile({ clinicId: "missing", contactId: contact.id, values: same })).toBeNull();
  });
});
