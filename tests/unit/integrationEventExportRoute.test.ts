import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentOperator: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock("@/server/auth/operatorSession", () => ({ getCurrentOperator: mocks.getCurrentOperator }));
vi.mock("@/server/db/prismaClient", () => ({
  prisma: {
    integrationEvent: {
      findMany: mocks.findMany,
    },
  },
}));

import { GET } from "@/app/api/ops/integration-events/export/route";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/ops/integration-events/export", () => {
  it("未ログインの場合は401を返し、DBを参照しない", async () => {
    mocks.getCurrentOperator.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("pending/failedのみを抽出するクエリを発行する", async () => {
    mocks.getCurrentOperator.mockResolvedValue({ id: "op-1", email: "ops@example.com", role: "admin" });
    mocks.findMany.mockResolvedValue([]);

    await GET();

    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: { in: ["pending", "failed"] } },
      })
    );
  });

  it("CSVはUTF-8 BOM付きで、認証済み時にtext/csvとして返る", async () => {
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
        payloadJson: JSON.stringify({ email: "a@example.com", clinic_name: "テスト歯科" }),
      },
    ]);

    const response = await GET();
    const buffer = new Uint8Array(await response.arrayBuffer());
    const text = new TextDecoder("utf-8").decode(buffer);

    expect(response.headers.get("Content-Type")).toContain("text/csv");
    expect(response.headers.get("Content-Disposition")).toContain("attachment");
    // UTF-8 BOM: EF BB BF (response.text()はTextDecoderの既定挙動でBOMを剥がしてしまうため、
    // 生バイト列で確認する)。
    expect(buffer[0]).toBe(0xef);
    expect(buffer[1]).toBe(0xbb);
    expect(buffer[2]).toBe(0xbf);
    expect(text).toContain("evt_1");
    expect(text).toContain("diagnosis_completed");
  });

  it("CSVインジェクション対策: =,+,-,@で始まるセル値はシングルクォートを前置してエスケープする", async () => {
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
        payloadJson: "{}",
      },
    ]);

    const response = await GET();
    const text = await response.text();

    expect(text).toContain("'=cmd|'/c calc'!A1");
    expect(text).not.toMatch(/(?<!')(?<!")=cmd\|/);
  });

  it("payloadのメールアドレス等はマスクされて出力される(生の値を出さない)", async () => {
    mocks.getCurrentOperator.mockResolvedValue({ id: "op-1", email: "ops@example.com", role: "admin" });
    mocks.findMany.mockResolvedValue([
      {
        id: "evt_3",
        eventType: "phone_verified",
        status: "pending",
        retryCount: 0,
        lastError: null,
        clinicId: "clinic_2",
        contactId: "contact_2",
        createdAt: new Date("2026-09-29T00:00:00.000Z"),
        lastAttemptedAt: null,
        nextRetryAt: null,
        payloadJson: JSON.stringify({ email: "secret@example.com", clinic_name: "秘密歯科" }),
      },
    ]);

    const response = await GET();
    const text = await response.text();

    expect(text).not.toContain("secret@example.com");
  });
});
