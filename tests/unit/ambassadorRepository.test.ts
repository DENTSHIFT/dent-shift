import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  attributionFindUnique: vi.fn(),
  attributionUpdate: vi.fn(),
}));

vi.mock("@/server/db/prismaClient", () => ({
  prisma: {},
}));

import { confirmAttributionForClinic } from "@/server/db/ambassadorRepository";

const tx = {
  attribution: {
    findUnique: mocks.attributionFindUnique,
    update: mocks.attributionUpdate,
  },
} as unknown as Parameters<typeof confirmAttributionForClinic>[0];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("confirmAttributionForClinic", () => {
  it("該当clinicのattributionが無ければ何もしない", async () => {
    mocks.attributionFindUnique.mockResolvedValue(null);
    await confirmAttributionForClinic(tx, "clinic_1");
    expect(mocks.attributionUpdate).not.toHaveBeenCalled();
  });

  it("pending状態ならconfirmedへ更新する(有料契約+初回入金確定)", async () => {
    mocks.attributionFindUnique.mockResolvedValue({ id: "attr_1", status: "pending" });
    await confirmAttributionForClinic(tx, "clinic_1");
    expect(mocks.attributionUpdate).toHaveBeenCalledWith({
      where: { id: "attr_1" },
      data: expect.objectContaining({ status: "confirmed" }),
    });
  });

  it("既にconfirmed済みなら二重更新しない", async () => {
    mocks.attributionFindUnique.mockResolvedValue({ id: "attr_2", status: "confirmed" });
    await confirmAttributionForClinic(tx, "clinic_2");
    expect(mocks.attributionUpdate).not.toHaveBeenCalled();
  });
});
