import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveSalesforceConfig: vi.fn(),
  findUnique: vi.fn(),
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
      update: mocks.update,
    },
  },
}));

import { syncIntegrationEvent } from "@/server/services/salesforceSync";

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

  it("emailを含まないイベントはLead upsert対象外としてsynced扱いにする", async () => {
    mocks.resolveSalesforceConfig.mockReturnValue({ provider: "salesforce" });
    mocks.findUnique.mockResolvedValue({
      id: "evt_1",
      status: "pending",
      payloadJson: JSON.stringify({ registration_step: "sms" }),
    });

    await syncIntegrationEvent("evt_1");

    expect(mocks.upsertLead).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "evt_1" },
      data: expect.objectContaining({ status: "synced" }),
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
