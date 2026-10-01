import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveSalesforceConfig: vi.fn(),
  eventFindUnique: vi.fn(),
  eventFindMany: vi.fn(),
  eventUpdate: vi.fn(),
  clinicFindUnique: vi.fn(),
  contactFindUnique: vi.fn(),
  eventCount: vi.fn(),
  eventFindFirst: vi.fn(),
  bookingFindMany: vi.fn(),
  upsert: vi.fn(),
  getByExternalId: vi.fn(),
  getById: vi.fn(),
  updateById: vi.fn(),
  acquireLock: vi.fn(),
  renewLock: vi.fn(),
  releaseLock: vi.fn(),
  notify: vi.fn(),
}));

vi.mock("@/server/config/salesforceConfig", () => ({
  resolveSalesforceConfigFromProcessEnv: mocks.resolveSalesforceConfig,
}));
vi.mock("@/server/providers/salesforce/salesforceClient", async () => {
  const actual = await vi.importActual<typeof import("@/server/providers/salesforce/salesforceClient")>(
    "@/server/providers/salesforce/salesforceClient"
  );
  return {
    ...actual,
    upsertSalesforceRecordByExternalId: mocks.upsert,
    getSalesforceRecordByExternalId: mocks.getByExternalId,
    getSalesforceRecordById: mocks.getById,
    updateSalesforceRecordById: mocks.updateById,
  };
});
vi.mock("@/server/db/crmSyncLockRepository", () => ({
  acquireCrmSyncLock: mocks.acquireLock,
  renewCrmSyncLock: mocks.renewLock,
  releaseCrmSyncLock: mocks.releaseLock,
}));
vi.mock("@/server/services/notifySalesforceSyncFailure", () => ({
  notifySalesforceSyncFailure: mocks.notify,
}));
vi.mock("@/server/db/prismaClient", () => ({
  prisma: {
    integrationEvent: {
      findUnique: mocks.eventFindUnique,
      findMany: mocks.eventFindMany,
      update: mocks.eventUpdate,
      count: mocks.eventCount,
      findFirst: mocks.eventFindFirst,
    },
    consultationBooking: { findMany: mocks.bookingFindMany },
    clinic: { findUnique: mocks.clinicFindUnique },
    contact: { findUnique: mocks.contactFindUnique },
  },
}));

import { ORG_MISMATCH_ERROR_CODE, SalesforceDeliveryError } from "@/server/providers/salesforce/salesforceClient";
import {
  syncIntegrationEvent,
  computeNextRetryAt,
  retryPendingIntegrationEvents,
  MAX_RETRY_COUNT,
} from "@/server/services/salesforceSync";

const SF = {
  provider: "salesforce" as const,
  clientId: "id",
  clientSecret: "secret",
  loginUrl: "https://x.my.salesforce.com",
  expectedOrgId: "00D000000000001",
};

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt_1",
    eventType: "diagnosis_completed",
    status: "pending",
    retryCount: 0,
    alertedAt: null,
    clinicId: "clinic_1",
    contactId: null,
    payloadJson: "{}",
    ...overrides,
  };
}

function clinicRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "clinic_1",
    name: "テスト歯科",
    directorName: "山田",
    url: "https://www.example-dental.jp/",
    contactEmail: "info@example-dental.jp",
    contactPhone: "0300000000",
    utmSource: "prtimes",
    utmMedium: null,
    utmCampaign: null,
    utmContent: null,
    utmTerm: null,
    _count: { diagnoses: 2 },
    diagnoses: [
      {
        id: "diag_9",
        measuredAt: new Date("2026-10-01T03:00:00Z"),
        totalPoints: 55,
        totalStatus: "要改善",
        isSample: false,
        improvementTasksJson: JSON.stringify([{ title: "Web予約導線" }]),
        aiObservations: [{ provider: "openai", mention: false, measurementStatus: "measured" }],
      },
    ],
    contacts: [],
    subscriptions: [],
    ...overrides,
  };
}

const CONTACT = {
  id: "user_1",
  email: "owner@example-dental.jp",
  phoneNumber: null,
  role: "owner",
  registrationStep: "completed",
  emailVerifiedAt: new Date("2026-10-01T04:00:00Z"),
  phoneVerifiedAt: null,
  consentAcceptedAt: new Date("2026-10-01T04:05:00Z"),
  createdAt: new Date("2026-10-01T04:00:00Z"),
};

const SUBSCRIPTION = {
  id: "sub_1",
  plan: "standard",
  status: "trial",
  createdAt: new Date("2026-10-01T05:00:00Z"),
  trialStartedAt: new Date("2026-10-01T05:00:00Z"),
  trialEndsAt: new Date("2026-10-08T05:00:00Z"),
  currentPeriodEnd: new Date("2026-10-08T05:00:00Z"),
  cancelAtPeriodEnd: false,
  cancelAt: null,
  canceledAt: null,
  endedAt: null,
  billingExempt: false,
  firstActivatedAt: null,
  paymentMethodStatus: "completed",
  externalSubscriptionId: "sub_stripe_1",
};

function upsertCallsFor(sobject: string) {
  return mocks.upsert.mock.calls.map(([arg]) => arg).filter((arg) => arg.sobject === sobject);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveSalesforceConfig.mockReturnValue(SF);
  mocks.upsert.mockResolvedValue({ id: "sf_id", created: false });
  mocks.getByExternalId.mockResolvedValue(null);
  mocks.acquireLock.mockResolvedValue(true);
  mocks.renewLock.mockResolvedValue(true);
  mocks.releaseLock.mockResolvedValue(undefined);
  mocks.eventCount.mockResolvedValue(0);
  mocks.eventFindFirst.mockResolvedValue(null);
  mocks.bookingFindMany.mockResolvedValue([]);
  mocks.notify.mockResolvedValue(true);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("syncIntegrationEvent", () => {
  it("Salesforce未接続(disabled)時は何もせず終了する(診断・登録を止めない)", async () => {
    mocks.resolveSalesforceConfig.mockReturnValue({ provider: "disabled" });
    await syncIntegrationEvent("evt_1");
    expect(mocks.eventFindUnique).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("メールアドレスを含まないイベントでも、医院IDを外部IDとしてLeadへ同期できる", async () => {
    mocks.eventFindUnique.mockResolvedValue(event({ eventType: "diagnosis_started", payloadJson: "{}" }));
    mocks.clinicFindUnique.mockResolvedValue(clinicRow());
    mocks.upsert.mockResolvedValue({ id: "00Qlead", created: false });

    await syncIntegrationEvent("evt_1");

    const [lead] = upsertCallsFor("Lead");
    expect(lead.externalIdField).toBe("DentShift_Clinic_Id__c");
    expect(lead.externalId).toBe("clinic_1");
    expect(lead.fields).toEqual(
      expect.objectContaining({
        Company: "テスト歯科",
        LastName: "山田",
        Event_Type__c: "diagnosis_started",
        DentShift_Diagnosis_Count__c: 2,
        DentShift_Site_Domain__c: "example-dental.jp",
        DentShift_UTM_Source__c: "prtimes",
      })
    );
    // 取得していないUTMは推測で埋めない(値がない項目は送らない)
    expect(lead.fields).not.toHaveProperty("DentShift_UTM_Medium__c");
    expect(mocks.eventUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "synced", externalId: "00Qlead" }) })
    );
  });

  it("Leadを新規作成した場合だけ、営業電話禁止(DoNotCall)を設定する", async () => {
    mocks.eventFindUnique.mockResolvedValue(event());
    mocks.clinicFindUnique.mockResolvedValue(clinicRow());
    mocks.upsert.mockResolvedValueOnce({ id: "00Qnew", created: true });

    await syncIntegrationEvent("evt_1");

    const leadCalls = upsertCallsFor("Lead");
    expect(leadCalls).toHaveLength(2);
    expect(leadCalls[1].fields).toEqual({ DoNotCall: true });

    vi.clearAllMocks();
    mocks.resolveSalesforceConfig.mockReturnValue(SF);
    mocks.eventFindUnique.mockResolvedValue(event());
    mocks.clinicFindUnique.mockResolvedValue(clinicRow());
    mocks.upsert.mockResolvedValue({ id: "00Qnew", created: false });

    await syncIntegrationEvent("evt_1");
    expect(upsertCallsFor("Lead")).toHaveLength(1);
    expect(JSON.stringify(mocks.upsert.mock.calls)).not.toContain("DoNotCall");
  });

  it("同じメールアドレスでも医院IDが異なれば別々の外部IDで送り、メールで統合しない", async () => {
    mocks.eventFindUnique
      .mockResolvedValueOnce(event({ id: "evt_a", clinicId: "clinic_a" }))
      .mockResolvedValueOnce(event({ id: "evt_b", clinicId: "clinic_b" }));
    mocks.clinicFindUnique
      .mockResolvedValueOnce(clinicRow({ id: "clinic_a" }))
      .mockResolvedValueOnce(clinicRow({ id: "clinic_b" }));

    await syncIntegrationEvent("evt_a");
    await syncIntegrationEvent("evt_b");

    expect(upsertCallsFor("Lead").map((c) => c.externalId)).toEqual(["clinic_a", "clinic_b"]);
  });

  it("会員登録・契約済みの医院はAccount/Contact/OpportunityをアプリのIDで同期する", async () => {
    mocks.eventFindUnique.mockResolvedValue(event({ eventType: "subscription_updated" }));
    mocks.clinicFindUnique.mockResolvedValue(clinicRow({ contacts: [CONTACT], subscriptions: [SUBSCRIPTION] }));

    await syncIntegrationEvent("evt_1");

    expect(upsertCallsFor("Account")[0]).toEqual(
      expect.objectContaining({ externalIdField: "DentShift_Clinic_Id__c", externalId: "clinic_1" })
    );
    const [contact] = upsertCallsFor("Contact");
    expect(contact.externalId).toBe("user_1");
    expect(contact.fields.Account).toEqual({ DentShift_Clinic_Id__c: "clinic_1" });
    const [opportunity] = upsertCallsFor("Opportunity");
    expect(opportunity.externalId).toBe("sub_1");
    expect(opportunity.fields).toEqual(
      expect.objectContaining({
        StageName: "Qualification",
        CloseDate: "2026-10-08",
        DentShift_Plan__c: "standard",
        DentShift_Billing_Status__c: "trial",
        DentShift_Next_Renewal_Date__c: "2026-10-08",
        DentShift_Cancel_At_Period_End__c: false,
      })
    );
    // 順序: Accountを先に作り、Contact/OpportunityはAccountの外部IDで紐づける
    const order = mocks.upsert.mock.calls.map(([arg]) => arg.sobject);
    expect(order.indexOf("Account")).toBeLessThan(order.indexOf("Contact"));
    expect(order.indexOf("Account")).toBeLessThan(order.indexOf("Opportunity"));
  });

  it("同じイベントを再送しても同じ外部IDへのupsertになる(重複作成しない)", async () => {
    mocks.eventFindUnique.mockResolvedValue(event());
    mocks.clinicFindUnique.mockResolvedValue(clinicRow({ contacts: [CONTACT], subscriptions: [SUBSCRIPTION] }));

    await syncIntegrationEvent("evt_1");
    const first = mocks.upsert.mock.calls.map(([a]) => `${a.sobject}:${a.externalId}`);
    mocks.upsert.mockClear();
    await syncIntegrationEvent("evt_1");
    const second = mocks.upsert.mock.calls.map(([a]) => `${a.sobject}:${a.externalId}`);

    expect(second).toEqual(first);
  });

  it("コンバート済みLeadは更新せず、コンバート先のAccount/Contactへ外部IDを設定して同期を続ける(重複作成しない)", async () => {
    mocks.eventFindUnique.mockResolvedValue(event());
    mocks.clinicFindUnique.mockResolvedValue(clinicRow({ contacts: [CONTACT] }));
    mocks.getByExternalId.mockImplementation(async ({ sobject }) =>
      sobject === "Lead"
        ? { Id: "00Q1", IsConverted: true, ConvertedAccountId: "001AAAAAAAAAAAA", ConvertedContactId: "003AAAAAAAAAAAA", ConvertedOpportunityId: null }
        : null
    );
    mocks.getById.mockResolvedValue({ Id: "x", DentShift_Clinic_Id__c: null, DentShift_User_Id__c: null });

    await syncIntegrationEvent("evt_1");

    expect(upsertCallsFor("Lead")).toHaveLength(0);
    expect(mocks.updateById).toHaveBeenCalledWith(
      expect.objectContaining({ sobject: "Account", id: "001AAAAAAAAAAAA", fields: { DentShift_Clinic_Id__c: "clinic_1" } })
    );
    expect(mocks.updateById).toHaveBeenCalledWith(
      expect.objectContaining({ sobject: "Contact", id: "003AAAAAAAAAAAA", fields: { DentShift_User_Id__c: "user_1" } })
    );
    // その後の更新は外部IDでコンバート先へ届く(新規作成ではなく同じレコード)
    expect(upsertCallsFor("Account")[0].externalId).toBe("clinic_1");
    expect(mocks.eventUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "synced" }) })
    );
  });

  it("コンバート済みで、外部IDが既に別の取引先にある場合は自動統合せず要確認(failed)にする", async () => {
    mocks.eventFindUnique.mockResolvedValue(event());
    mocks.clinicFindUnique.mockResolvedValue(clinicRow({ contacts: [CONTACT] }));
    mocks.getByExternalId.mockImplementation(async ({ sobject }) =>
      sobject === "Lead"
        ? { Id: "00Q1", IsConverted: true, ConvertedAccountId: "001AAAAAAAAAAAA", ConvertedContactId: null, ConvertedOpportunityId: null }
        : { Id: "001BBBBBBBBBBBB" }
    );

    await syncIntegrationEvent("evt_1");

    expect(mocks.updateById).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.eventUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "failed", retryCount: MAX_RETRY_COUNT, lastError: expect.stringContaining("converted_lead_conflict") }),
      })
    );
  });

  it("TimeRexの相談予約を予約IDで同期し、医院の要約(CTAクリック・次回相談)も送る", async () => {
    mocks.eventFindUnique.mockResolvedValue(event({ eventType: "online_consultation_booked" }));
    mocks.clinicFindUnique.mockResolvedValue(clinicRow());
    mocks.eventCount.mockResolvedValue(3);
    mocks.eventFindFirst.mockResolvedValue({ createdAt: new Date("2026-10-01T05:00:00Z") });
    mocks.bookingFindMany.mockResolvedValue([
      {
        timerexEventId: "tx_1",
        status: "confirmed",
        contactId: "user_other",
        matchMethod: "signed_ref",
        startAt: new Date("2099-01-01T01:00:00Z"),
        endAt: new Date("2099-01-01T01:45:00Z"),
        bookedAt: null,
        canceledAt: null,
        calendarName: null,
        hostName: null,
      },
    ]);

    await syncIntegrationEvent("evt_1");

    const [booking] = upsertCallsFor("DentShift_Consultation__c");
    expect(booking.externalIdField).toBe("DentShift_TimeRex_Event_Id__c");
    expect(booking.externalId).toBe("tx_1");
    // この医院の会員でないContactへは紐づけない
    expect(booking.fields).not.toHaveProperty("DentShift_Contact__r");
    const [lead] = upsertCallsFor("Lead");
    expect(lead.fields).toEqual(
      expect.objectContaining({
        DentShift_Consultation_Cta_Clicks__c: 3,
        DentShift_Next_Consultation_At__c: "2099-01-01T01:00:00.000Z",
      })
    );
    expect(upsertCallsFor("Task")).toHaveLength(0);
  });

  it("同じ医院の同期が実行中なら試行回数を消費せず、少し後に再試行する", async () => {
    mocks.eventFindUnique.mockResolvedValue(event({ retryCount: 2 }));
    mocks.acquireLock.mockResolvedValue(false);

    await expect(syncIntegrationEvent("evt_1")).resolves.toBe("busy");

    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.clinicFindUnique).not.toHaveBeenCalled();
    expect(mocks.eventUpdate).toHaveBeenCalledWith({ where: { id: "evt_1" }, data: { nextRetryAt: expect.any(Date) } });
  });

  it("ロックが他の同期に引き継がれていたら、古い内容で書き込まずに中断する", async () => {
    mocks.eventFindUnique.mockResolvedValue(event());
    mocks.clinicFindUnique.mockResolvedValue(clinicRow({ contacts: [CONTACT] }));
    mocks.renewLock.mockResolvedValueOnce(true).mockResolvedValue(false);

    await expect(syncIntegrationEvent("evt_1")).rejects.toThrow("crm_sync_lock_lost");

    expect(mocks.upsert).toHaveBeenCalledTimes(1); // 最初のLeadだけ。以降は書き込まない
    expect(mocks.releaseLock).toHaveBeenCalledWith("clinic_1", expect.any(String));
  });

  it("ロックはロック取得後に読んだスナップショットで送り、終了時に自分のロックだけを解放する", async () => {
    const order: string[] = [];
    mocks.eventFindUnique.mockResolvedValue(event());
    mocks.acquireLock.mockImplementation(async () => (order.push("lock"), true));
    mocks.clinicFindUnique.mockImplementation(async () => (order.push("snapshot"), clinicRow()));
    mocks.releaseLock.mockImplementation(async () => void order.push("release"));

    await syncIntegrationEvent("evt_1");

    expect(order).toEqual(["lock", "snapshot", "release"]);
  });

  it("接続先組織の不一致では試行回数を消費しない(設定修正後にそのまま再送される)", async () => {
    mocks.eventFindUnique.mockResolvedValue(event({ retryCount: 1 }));
    mocks.clinicFindUnique.mockResolvedValue(clinicRow());
    mocks.getByExternalId.mockRejectedValue(new SalesforceDeliveryError("org mismatch", ORG_MISMATCH_ERROR_CODE));

    await expect(syncIntegrationEvent("evt_1")).rejects.toThrow("org mismatch");

    const data = mocks.eventUpdate.mock.calls.map(([arg]) => arg.data);
    expect(data.some((d) => "retryCount" in d)).toBe(false);
    expect(data.some((d) => d.status === "failed")).toBe(false);
  });

  it("医院を特定できないイベントは自動再試行せず要対応(failed)にし、通知する", async () => {
    mocks.eventFindUnique.mockResolvedValue(event({ clinicId: null, contactId: null }));

    await syncIntegrationEvent("evt_1");

    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.eventUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "failed", retryCount: MAX_RETRY_COUNT, nextRetryAt: null }),
      })
    );
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ eventId: "evt_1" }));
  });

  it("contactIdだけを持つイベントはContactから医院を特定して同期する", async () => {
    mocks.eventFindUnique.mockResolvedValue(event({ clinicId: null, contactId: "user_1" }));
    mocks.contactFindUnique.mockResolvedValue({ clinicId: "clinic_1" });
    mocks.clinicFindUnique.mockResolvedValue(clinicRow({ contacts: [CONTACT] }));

    await syncIntegrationEvent("evt_1");

    expect(upsertCallsFor("Lead")[0].externalId).toBe("clinic_1");
  });

  it("一時的な失敗はretryCountを増やし次回再試行時刻を保存して例外を再送出する(通知はしない)", async () => {
    mocks.eventFindUnique.mockResolvedValue(event({ retryCount: 2 }));
    mocks.clinicFindUnique.mockResolvedValue(clinicRow());
    mocks.upsert.mockRejectedValue(new SalesforceDeliveryError("Salesforce Lead upsert returned HTTP 503."));

    await expect(syncIntegrationEvent("evt_1")).rejects.toThrow("HTTP 503");

    expect(mocks.eventUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "failed", retryCount: 3, nextRetryAt: expect.any(Date) }),
      })
    );
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("再試行上限に達した時点で一度だけ通知し、通知済みなら再通知しない", async () => {
    mocks.clinicFindUnique.mockResolvedValue(clinicRow());
    mocks.upsert.mockRejectedValue(new SalesforceDeliveryError("HTTP 500"));

    mocks.eventFindUnique.mockResolvedValue(event({ retryCount: MAX_RETRY_COUNT - 1, alertedAt: null }));
    await expect(syncIntegrationEvent("evt_1")).rejects.toThrow();
    expect(mocks.notify).toHaveBeenCalledTimes(1);
    expect(mocks.eventUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { alertedAt: expect.any(Date) } })
    );

    mocks.notify.mockClear();
    mocks.eventFindUnique.mockResolvedValue(
      event({ retryCount: MAX_RETRY_COUNT - 1, alertedAt: new Date() })
    );
    await expect(syncIntegrationEvent("evt_1")).rejects.toThrow();
    expect(mocks.notify).not.toHaveBeenCalled();
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
    expect(mocks.eventFindMany).not.toHaveBeenCalled();
    expect(result).toEqual({ attempted: 0 });
  });

  it("nextRetryAtが未到来のfailedイベントを対象から除外する条件でクエリする", async () => {
    mocks.eventFindMany.mockResolvedValue([]);
    await retryPendingIntegrationEvents(10);
    expect(mocks.eventFindMany).toHaveBeenCalledWith(
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

  it("対象イベントごとにsyncIntegrationEventを試行し、1件の失敗で残りを止めない", async () => {
    mocks.eventFindMany.mockResolvedValue([{ id: "evt_a" }, { id: "evt_b" }]);
    mocks.eventFindUnique.mockImplementation(({ where }: { where: { id: string } }) =>
      Promise.resolve(event({ id: where.id }))
    );
    mocks.clinicFindUnique.mockResolvedValue(clinicRow());
    mocks.upsert.mockRejectedValueOnce(new SalesforceDeliveryError("HTTP 503"));

    const result = await retryPendingIntegrationEvents(10);

    expect(result).toEqual({ attempted: 2 });
    expect(mocks.eventUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "evt_b" }, data: expect.objectContaining({ status: "synced" }) })
    );
  });

  it("接続先組織の不一致・認証失敗では、その回の残りの再送を打ち切る", async () => {
    mocks.eventFindMany.mockResolvedValue([{ id: "evt_a" }, { id: "evt_b" }]);
    mocks.eventFindUnique.mockImplementation(({ where }: { where: { id: string } }) => Promise.resolve(event({ id: where.id })));
    mocks.clinicFindUnique.mockResolvedValue(clinicRow());
    mocks.getByExternalId.mockRejectedValue(new SalesforceDeliveryError("org mismatch", ORG_MISMATCH_ERROR_CODE));

    const result = await retryPendingIntegrationEvents(10);

    expect(result).toEqual({ attempted: 1, stoppedReason: "connection_error" });
  });
});
