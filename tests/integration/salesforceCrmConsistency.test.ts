import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { applyPrismaMigrationsToTestDatabase } from "../helpers/testDatabase";
import type { BillingWebhookCommand, SubscriptionBillingPeriod } from "@/domain/billing/billingWebhook";
import type { TimeRexBookingNotice } from "@/domain/integration/timerexWebhook";

/**
 * Salesforce連携の前提となるDB側の整合性を、実DB(全マイグレーション適用済みのSQLite)で確認する。
 * - 古いStripe通知が後から届いても、契約期間・解約予定・トライアル日付・プランを巻き戻さない
 * - 一度有料化した事実(firstActivatedAt)は解約後も、通知の順序が逆でも残る
 * - 医院単位の同期ロック(取得・競合・期限切れの引き継ぎ・所有者以外は解放できない)
 * - TimeRex予約: 同じ予約IDの再通知で重複しない/キャンセル後の古い予約成立通知で戻らない/
 *   キャンセル通知(url_paramsなし)でも既存の医院対応付けを維持する/推測で紐づけない
 */

let testDbDir: string;
let prisma: import("@prisma/client").PrismaClient;
let billingRepository: typeof import("@/server/db/billingRepository");
let lockRepository: typeof import("@/server/db/crmSyncLockRepository");
let bookings: typeof import("@/server/services/timerexBookings");
let bookingRef: typeof import("@/server/integration/bookingRef");

beforeAll(async () => {
  const root = process.platform === "darwin" ? realpathSync("/tmp") : realpathSync(tmpdir());
  testDbDir = mkdtempSync(path.join(root, "dent-shift-sf-consistency-"));
  const dbPath = path.join(testDbDir, "test.db");
  process.env.DATABASE_URL = `file:${dbPath}`;
  process.env.TIMEREX_BOOKING_REF_SECRET = "integration-test-secret";
  applyPrismaMigrationsToTestDatabase(dbPath);

  prisma = (await import("@/server/db/prismaClient")).prisma;
  billingRepository = await import("@/server/db/billingRepository");
  lockRepository = await import("@/server/db/crmSyncLockRepository");
  bookings = await import("@/server/services/timerexBookings");
  bookingRef = await import("@/server/integration/bookingRef");
}, 60000);

afterAll(async () => {
  await prisma?.$disconnect();
  if (testDbDir) rmSync(testDbDir, { recursive: true, force: true });
});

let seq = 0;
async function createClinic() {
  seq += 1;
  return prisma.clinic.create({ data: { name: `整合性テスト歯科${seq}`, url: `https://consistency-${seq}.example.com` } });
}

function period(overrides: Partial<SubscriptionBillingPeriod> = {}): SubscriptionBillingPeriod {
  return { currentPeriodEnd: null, cancelAtPeriodEnd: false, cancelAt: null, canceledAt: null, endedAt: null, ...overrides };
}

function statusCommand(input: {
  eventId: string;
  externalSubscriptionId: string;
  clinicId: string;
  status: "trial" | "active" | "cancelled" | "past_due";
  occurredAt: string;
  plan?: "light" | "standard" | "premium";
  billingPeriod?: SubscriptionBillingPeriod;
  trialEndsAt?: string;
}): BillingWebhookCommand {
  return {
    providerEventId: input.eventId,
    eventType: "customer.subscription.updated",
    occurredAt: new Date(input.occurredAt),
    action: {
      kind: "subscription_status",
      identity: { externalSubscriptionId: input.externalSubscriptionId, clinicId: input.clinicId, plan: input.plan ?? "standard" },
      status: input.status,
      ...(input.trialEndsAt
        ? { trialStartedAt: new Date("2026-10-01T00:00:00Z"), trialEndsAt: new Date(input.trialEndsAt) }
        : {}),
      billingPeriod: input.billingPeriod ?? period(),
    },
  };
}

describe("Stripe通知の順序逆転", () => {
  it("新しい通知を適用した後に古い通知が届いても、期間・解約予定・トライアル日付・プランを巻き戻さない", async () => {
    const clinic = await createClinic();
    const sub = `sub_order_${clinic.id}`;
    await billingRepository.applyBillingWebhookEvent(
      statusCommand({ eventId: `evt_new_${clinic.id}`, externalSubscriptionId: sub, clinicId: clinic.id, status: "active",
        occurredAt: "2026-10-10T00:00:00Z", plan: "premium", trialEndsAt: "2026-10-08T00:00:00Z",
        billingPeriod: period({ currentPeriodEnd: new Date("2026-11-10T00:00:00Z"), cancelAtPeriodEnd: true, cancelAt: new Date("2026-11-10T00:00:00Z") }) })
    );
    // 古い通知(解約予約前・旧プラン・旧トライアル終了日)が遅れて届く
    await billingRepository.applyBillingWebhookEvent(
      statusCommand({ eventId: `evt_old_${clinic.id}`, externalSubscriptionId: sub, clinicId: clinic.id, status: "active",
        occurredAt: "2026-10-05T00:00:00Z", plan: "standard", trialEndsAt: "2026-10-07T00:00:00Z",
        billingPeriod: period({ currentPeriodEnd: new Date("2026-10-08T00:00:00Z") }) })
    );

    const row = await prisma.subscription.findUniqueOrThrow({ where: { externalSubscriptionId: sub } });
    expect(row.plan).toBe("premium");
    expect(row.cancelAtPeriodEnd).toBe(true);
    expect(row.currentPeriodEnd).toEqual(new Date("2026-11-10T00:00:00Z"));
    expect(row.trialEndsAt).toEqual(new Date("2026-10-08T00:00:00Z"));
    expect(row.detailsEventAt).toEqual(new Date("2026-10-10T00:00:00Z"));
  });

  it("有料化(active)→解約の後も、初回有料化日時を保持する", async () => {
    const clinic = await createClinic();
    const sub = `sub_won_${clinic.id}`;
    await billingRepository.applyBillingWebhookEvent(
      statusCommand({ eventId: `evt_a_${clinic.id}`, externalSubscriptionId: sub, clinicId: clinic.id, status: "active", occurredAt: "2026-10-08T00:00:00Z" })
    );
    await billingRepository.applyBillingWebhookEvent(
      statusCommand({ eventId: `evt_c_${clinic.id}`, externalSubscriptionId: sub, clinicId: clinic.id, status: "cancelled", occurredAt: "2026-12-01T00:00:00Z",
        billingPeriod: period({ canceledAt: new Date("2026-11-20T00:00:00Z"), endedAt: new Date("2026-12-01T00:00:00Z") }) })
    );
    const row = await prisma.subscription.findUniqueOrThrow({ where: { externalSubscriptionId: sub } });
    expect(row.status).toBe("cancelled");
    expect(row.firstActivatedAt).toEqual(new Date("2026-10-08T00:00:00Z"));
    expect(row.endedAt).toEqual(new Date("2026-12-01T00:00:00Z"));
  });

  it("解約通知が先に届き、有料化通知が後から届いても、状態は戻さず初回有料化日時だけ記録する", async () => {
    const clinic = await createClinic();
    const sub = `sub_rev_${clinic.id}`;
    await billingRepository.applyBillingWebhookEvent(
      statusCommand({ eventId: `evt_c_${clinic.id}`, externalSubscriptionId: sub, clinicId: clinic.id, status: "cancelled", occurredAt: "2026-12-01T00:00:00Z" })
    );
    await billingRepository.applyBillingWebhookEvent(
      statusCommand({ eventId: `evt_a_${clinic.id}`, externalSubscriptionId: sub, clinicId: clinic.id, status: "active", occurredAt: "2026-10-08T00:00:00Z" })
    );
    const row = await prisma.subscription.findUniqueOrThrow({ where: { externalSubscriptionId: sub } });
    expect(row.status).toBe("cancelled");
    expect(row.firstActivatedAt).toEqual(new Date("2026-10-08T00:00:00Z"));
  });

  it("トライアルのまま解約した契約には初回有料化日時を付けない", async () => {
    const clinic = await createClinic();
    const sub = `sub_lost_${clinic.id}`;
    await billingRepository.applyBillingWebhookEvent(
      statusCommand({ eventId: `evt_t_${clinic.id}`, externalSubscriptionId: sub, clinicId: clinic.id, status: "trial", occurredAt: "2026-10-01T00:00:00Z" })
    );
    await billingRepository.applyBillingWebhookEvent(
      statusCommand({ eventId: `evt_c_${clinic.id}`, externalSubscriptionId: sub, clinicId: clinic.id, status: "cancelled", occurredAt: "2026-10-08T00:00:00Z" })
    );
    const row = await prisma.subscription.findUniqueOrThrow({ where: { externalSubscriptionId: sub } });
    expect(row.firstActivatedAt).toBeNull();
  });
});

describe("医院単位の同期ロック", () => {
  it("保持中は他の同期が取得できず、期限切れのみ引き継げ、所有者以外は延長・解放できない", async () => {
    const clinicId = "lock_clinic_1";
    const t0 = new Date("2026-10-01T00:00:00Z");
    expect(await lockRepository.acquireCrmSyncLock(clinicId, "A", t0)).toBe(true);
    expect(await lockRepository.acquireCrmSyncLock(clinicId, "B", new Date(t0.getTime() + 1000))).toBe(false);

    // Aのリース期限切れ後はBが引き継ぐ。以後Aは延長(=書き込み)できない
    const afterLease = new Date(t0.getTime() + lockRepository.CRM_SYNC_LOCK_LEASE_MS + 1000);
    expect(await lockRepository.acquireCrmSyncLock(clinicId, "B", afterLease)).toBe(true);
    expect(await lockRepository.renewCrmSyncLock(clinicId, "A", afterLease)).toBe(false);
    expect(await lockRepository.renewCrmSyncLock(clinicId, "B", afterLease)).toBe(true);

    // Aの解放処理はBのロックを消さない
    await lockRepository.releaseCrmSyncLock(clinicId, "A");
    expect(await prisma.crmSyncLock.findUnique({ where: { clinicId } })).not.toBeNull();
    await lockRepository.releaseCrmSyncLock(clinicId, "B");
    expect(await prisma.crmSyncLock.findUnique({ where: { clinicId } })).toBeNull();
  });
});

function notice(overrides: Partial<TimeRexBookingNotice> = {}): TimeRexBookingNotice {
  return {
    webhookType: "event_confirmed",
    timerexEventId: `tx_${seq}`,
    startAt: new Date("2026-10-10T01:00:00Z"),
    endAt: new Date("2026-10-10T01:45:00Z"),
    bookedAt: new Date("2026-10-02T00:00:00Z"),
    canceledAt: null,
    calendarName: "45分相談",
    hostName: "担当A",
    guestEmail: null,
    urlParams: {},
    ...overrides,
  };
}

describe("TimeRex予約の保存", () => {
  it("署名付き医院参照で対応付け、再通知で重複せず、キャンセル後の古い予約成立通知で戻らない", async () => {
    const clinic = await createClinic();
    const ref = bookingRef.createBookingRef(clinic.id)!;
    const id = `tx_ref_${clinic.id}`;

    await bookings.applyTimeRexBooking(notice({ timerexEventId: id, urlParams: { ds_ref: ref } }));
    await bookings.applyTimeRexBooking(notice({ timerexEventId: id, urlParams: { ds_ref: ref } })); // TimeRexの再送
    // キャンセル通知にはurl_paramsが無い
    await bookings.applyTimeRexBooking(
      notice({ timerexEventId: id, webhookType: "event_cancelled", canceledAt: new Date("2026-10-05T00:00:00Z") })
    );
    const stale = await bookings.applyTimeRexBooking(notice({ timerexEventId: id, urlParams: { ds_ref: ref } }));

    expect(stale.outcome).toBe("ignored_stale");
    const rows = await prisma.consultationBooking.findMany({ where: { timerexEventId: id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(
      expect.objectContaining({ status: "cancelled", clinicId: clinic.id, matchMethod: "signed_ref", canceledAt: new Date("2026-10-05T00:00:00Z") })
    );
    const events = await prisma.integrationEvent.findMany({ where: { clinicId: clinic.id }, orderBy: { createdAt: "asc" } });
    expect(events.map((e) => e.eventType)).toEqual(["online_consultation_booked", "online_consultation_canceled"]);
  });

  it("会員のメールアドレスと一致した場合は担当者まで対応付ける", async () => {
    const clinic = await createClinic();
    const contact = await prisma.contact.create({
      data: { clinicId: clinic.id, email: `Owner${seq}@Example-Dental.jp`, passwordHash: "x" },
    });
    const result = await bookings.applyTimeRexBooking(
      notice({ timerexEventId: `tx_mail_${clinic.id}`, guestEmail: contact.email })
    );
    expect(result.matchMethod).toBe("contact_email");
    const row = await prisma.consultationBooking.findUniqueOrThrow({ where: { timerexEventId: `tx_mail_${clinic.id}` } });
    expect(row.contactId).toBe(contact.id);
  });

  it("医院の代表メールとの一致だけでは紐づけず、署名が不正な参照も使わない(推測しない)", async () => {
    const clinic = await prisma.clinic.create({
      data: { name: "代表メールだけ歯科", url: "https://only-clinic-mail.example.com", contactEmail: "info@only-clinic-mail.example.com" },
    });
    const result = await bookings.applyTimeRexBooking(
      notice({
        timerexEventId: `tx_unmatched_${clinic.id}`,
        guestEmail: "info@only-clinic-mail.example.com",
        urlParams: { ds_ref: `${clinic.id}.forged` },
      })
    );
    expect(result.matchMethod).toBe("unmatched");
    const row = await prisma.consultationBooking.findUniqueOrThrow({ where: { timerexEventId: `tx_unmatched_${clinic.id}` } });
    expect(row.clinicId).toBeNull();
    expect(await prisma.integrationEvent.count({ where: { clinicId: clinic.id } })).toBe(0);
  });
});
