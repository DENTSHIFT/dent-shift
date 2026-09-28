import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveSalesforceConfig: vi.fn(),
  findUnique: vi.fn(),
  findMany: vi.fn(),
  update: vi.fn(),
  upsertLead: vi.fn(),
}));

vi.mock("@/server/config/salesforceConfig", () => ({
  resolveSalesforceConfigFromProcessEnv: mocks.resolveSalesforceConfig,
}));
vi.mock("@/server/providers/salesforce/salesforceClient", () => ({
  upsertSalesforceLeadByEmail: mocks.upsertLead,
}));
vi.mock("@/server/db/prismaClient", () => ({
  prisma: {
    integrationEvent: {
      findUnique: mocks.findUnique,
      findMany: mocks.findMany,
      update: mocks.update,
    },
  },
}));

import {
  syncIntegrationEvent,
  computeNextRetryAt,
  retryPendingIntegrationEvents,
  MAX_RETRY_COUNT,
} from "@/server/services/salesforceSync";

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("syncIntegrationEvent", () => {
  it("Salesforce未接続(disabled)時は何もせず終了する(診断・登録を止めない)", async () => {
    mocks.resolveSalesforceConfig.mockReturnValue({ provider: "disabled" });

    await syncIntegrationEvent("evt_1");

    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.upsertLead).not.toHaveBeenCalled();
  });

  it("emailを含まないイベントはLead特定不能としてfailed(要確認)状態にし、synced扱いにしない", async () => {
    mocks.resolveSalesforceConfig.mockReturnValue({ provider: "salesforce" });
    mocks.findUnique.mockResolvedValue({
      id: "evt_1",
      status: "pending",
      retryCount: 0,
      payloadJson: JSON.stringify({ registration_step: "sms" }),
    });

    await syncIntegrationEvent("evt_1");

    expect(mocks.upsertLead).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "evt_1" },
      data: expect.objectContaining({
        status: "failed",
        lastError: expect.stringContaining("no_matchable_lead_identifier"),
        retryCount: MAX_RETRY_COUNT,
      }),
    });
  });

  it("同期成功時はsynced状態とexternalIdを保存する", async () => {
    mocks.resolveSalesforceConfig.mockReturnValue({ provider: "salesforce" });
    mocks.findUnique.mockResolvedValue({
      id: "evt_2",
      status: "pending",
      payloadJson: JSON.stringify({ email: "a@example.com", clinic_name: "テスト歯科" }),
    });
    mocks.upsertLead.mockResolvedValue({ salesforceId: "00Qabc" });

    await syncIntegrationEvent("evt_2");

    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "evt_2" },
      data: expect.objectContaining({ status: "synced", externalId: "00Qabc" }),
    });
  });

  it("同期失敗時はfailed状態とretryCount増分を保存し、例外を再送出する", async () => {
    mocks.resolveSalesforceConfig.mockReturnValue({ provider: "salesforce" });
    mocks.findUnique.mockResolvedValue({
      id: "evt_3",
      status: "pending",
      payloadJson: JSON.stringify({ email: "a@example.com" }),
    });
    mocks.upsertLead.mockRejectedValue(new Error("network error"));

    await expect(syncIntegrationEvent("evt_3")).rejects.toThrow("network error");

    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "evt_3" },
      data: expect.objectContaining({ status: "failed" }),
    });
  });
});

describe("computeNextRetryAt", () => {
  it("2^retryCount秒後を返す", () => {
    const now = new Date("2026-09-29T00:00:00.000Z");
    expect(computeNextRetryAt(1, now).getTime() - now.getTime()).toBe(2000);
    expect(computeNextRetryAt(3, now).getTime() - now.getTime()).toBe(8000);
  });

  it("上限30分でキャップされる", () => {
    const now = new Date("2026-09-29T00:00:00.000Z");
    expect(computeNextRetryAt(20, now).getTime() - now.getTime()).toBe(1000 * 60 * 30);
  });
});

describe("retryPendingIntegrationEvents", () => {
  it("Salesforce未接続(disabled)時はDBを参照せず終了する", async () => {
    mocks.resolveSalesforceConfig.mockReturnValue({ provider: "disabled" });

    const result = await retryPendingIntegrationEvents();

    expect(mocks.findMany).not.toHaveBeenCalled();
    expect(result).toEqual({ attempted: 0 });
  });

  it("nextRetryAtが未到来のfailedイベントを対象から除外する条件でクエリする", async () => {
    mocks.resolveSalesforceConfig.mockReturnValue({ provider: "salesforce" });
    mocks.findMany.mockResolvedValue([]);

    await retryPendingIntegrationEvents(10);

    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ["pending", "failed"] },
          retryCount: { lt: MAX_RETRY_COUNT },
          OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: expect.any(Date) } }],
        }),
        take: 10,
      })
    );
  });

  it("対象イベントごとにsyncIntegrationEventを試行し、件数を返す", async () => {
    mocks.resolveSalesforceConfig.mockReturnValue({ provider: "salesforce" });
    mocks.findMany.mockResolvedValue([
      { id: "evt_a", status: "pending", retryCount: 0, payloadJson: JSON.stringify({ email: "a@example.com" }) },
      { id: "evt_b", status: "failed", retryCount: 1, payloadJson: JSON.stringify({ email: "b@example.com" }) },
    ]);
    mocks.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
      Promise.resolve(
        where.id === "evt_a"
          ? { id: "evt_a", status: "pending", retryCount: 0, payloadJson: JSON.stringify({ email: "a@example.com" }) }
          : { id: "evt_b", status: "failed", retryCount: 1, payloadJson: JSON.stringify({ email: "b@example.com" }) }
      )
    );
    mocks.upsertLead.mockResolvedValue({ salesforceId: "00Qxyz" });

    const result = await retryPendingIntegrationEvents(10);

    expect(result).toEqual({ attempted: 2 });
    expect(mocks.upsertLead).toHaveBeenCalledTimes(2);
  });
});
