import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/db/prismaClient", () => ({ prisma: {} }));

import { retryOnConcurrentWrite } from "@/server/db/billingRepository";

describe("retryOnConcurrentWrite", () => {
  it("一意制約違反(P2002)は再試行して成功結果を返す", async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce({ code: "P2002" })
      .mockResolvedValueOnce("ok");
    await expect(retryOnConcurrentWrite(run)).resolves.toBe("ok");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("上限回数を超えたら元のエラーを投げる", async () => {
    const error = { code: "P2034" };
    const run = vi.fn().mockRejectedValue(error);
    await expect(retryOnConcurrentWrite(run, 2)).rejects.toBe(error);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("対象外のエラーは再試行しない", async () => {
    const run = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(retryOnConcurrentWrite(run)).rejects.toThrow("boom");
    expect(run).toHaveBeenCalledTimes(1);
  });
});
