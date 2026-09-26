import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { applyPrismaMigrationsToTestDatabase } from "../helpers/testDatabase";
import type { BillingWebhookCommand } from "@/domain/billing/billingWebhook";

/**
 * applyBillingWebhookEventが返すnotify(通知トリガー)が、実DB上の状態遷移に
 * 対して正しく発火/非発火することを確認する結合テスト。
 * 二重契約防止(billingCheckoutRoute.test.ts)と対をなす、支払い失敗通知の
 * 冪等性(Webhook再送での重複送信防止)がここでのポイント。
 */

let testDbDir: string;
let billingRepository: typeof import("@/server/db/billingRepository");
let prisma: import("@prisma/client").PrismaClient;

beforeAll(async () => {
  const testTmpRoot =
    process.platform === "darwin" ? realpathSync("/tmp") : realpathSync(tmpdir());
  testDbDir = mkdtempSync(path.join(testTmpRoot, "dent-shift-billing-notify-test-db-"));
  const testDbPath = path.join(testDbDir, "test.db");
  process.env.DATABASE_URL = `file:${testDbPath}`;

  applyPrismaMigrationsToTestDatabase(testDbPath);

  billingRepository = await import("@/server/db/billingRepository");
  const clientModule = await import("@/server/db/prismaClient");
  prisma = clientModule.prisma;
}, 60000);

afterAll(async () => {
  await prisma?.$disconnect();
  if (testDbDir) rmSync(testDbDir, { recursive: true, force: true });
});

async function createClinic(suffix: string) {
  return prisma.clinic.create({
    data: { name: `課金通知テスト歯科${suffix}`, url: `https://billing-notify-test${suffix}.example.com` },
  });
}

function subscriptionStatusCommand(input: {
  providerEventId: string;
  externalSubscriptionId: string;
  clinicId: string | null;
  status: "active" | "past_due" | "restricted" | "suspended" | "cancelled";
  occurredAt: Date;
}): BillingWebhookCommand {
  return {
    providerEventId: input.providerEventId,
    eventType: "customer.subscription.updated",
    occurredAt: input.occurredAt,
    action: {
      kind: "subscription_status",
      identity: {
        externalSubscriptionId: input.externalSubscriptionId,
        clinicId: input.clinicId,
        plan: input.clinicId ? "light" : null,
      },
      status: input.status,
    },
  };
}

describe("applyBillingWebhookEvent: notify(通知トリガー)", () => {
  it("active→past_dueへ実際に遷移した場合のみnotifyを返す", async () => {
    const clinic = await createClinic("1");
    const externalSubscriptionId = `sub_notify_${clinic.id}`;

    const createResult = await billingRepository.applyBillingWebhookEvent(
      subscriptionStatusCommand({
        providerEventId: `evt_create_${clinic.id}`,
        externalSubscriptionId,
        clinicId: clinic.id,
        status: "active",
        occurredAt: new Date("2026-09-23T00:00:00Z"),
      })
    );
    expect(createResult.result).toBe("processed");
    expect(createResult.notify).toBeNull();

    const degradeResult = await billingRepository.applyBillingWebhookEvent(
      subscriptionStatusCommand({
        providerEventId: `evt_degrade_${clinic.id}`,
        externalSubscriptionId,
        clinicId: clinic.id,
        status: "past_due",
        occurredAt: new Date("2026-09-23T01:00:00Z"),
      })
    );
    expect(degradeResult.result).toBe("processed");
    expect(degradeResult.notify).toEqual({ clinicId: clinic.id, toStatus: "past_due" });
  });

  it("同じstatusを繰り返し報告するイベントは、2回目以降notifyを返さない(再送での重複送信防止)", async () => {
    const clinic = await createClinic("2");
    const externalSubscriptionId = `sub_repeat_${clinic.id}`;

    await billingRepository.applyBillingWebhookEvent(
      subscriptionStatusCommand({
        providerEventId: `evt_create_${clinic.id}`,
        externalSubscriptionId,
        clinicId: clinic.id,
        status: "past_due",
        occurredAt: new Date("2026-09-23T00:00:00Z"),
      })
    );

    // 別のStripeイベントIDで同じpast_dueを再度報告(例: invoice.payment_failedの再送に近い状況)。
    const secondResult = await billingRepository.applyBillingWebhookEvent(
      subscriptionStatusCommand({
        providerEventId: `evt_again_${clinic.id}`,
        externalSubscriptionId,
        clinicId: clinic.id,
        status: "past_due",
        occurredAt: new Date("2026-09-23T02:00:00Z"),
      })
    );
    expect(secondResult.result).toBe("processed");
    expect(secondResult.notify).toBeNull();
  });

  it("同一providerEventIdの再送(duplicate)はnotifyを返さない", async () => {
    const clinic = await createClinic("3");
    const externalSubscriptionId = `sub_dup_${clinic.id}`;

    await billingRepository.applyBillingWebhookEvent(
      subscriptionStatusCommand({
        providerEventId: `evt_create_${clinic.id}`,
        externalSubscriptionId,
        clinicId: clinic.id,
        status: "active",
        occurredAt: new Date("2026-09-23T00:00:00Z"),
      })
    );

    const command = subscriptionStatusCommand({
      providerEventId: `evt_dup_${clinic.id}`,
      externalSubscriptionId,
      clinicId: clinic.id,
      status: "restricted",
      occurredAt: new Date("2026-09-23T01:00:00Z"),
    });

    const first = await billingRepository.applyBillingWebhookEvent(command);
    expect(first.result).toBe("processed");
    expect(first.notify).toEqual({ clinicId: clinic.id, toStatus: "restricted" });

    const duplicate = await billingRepository.applyBillingWebhookEvent(command);
    expect(duplicate.result).toBe("duplicate");
    expect(duplicate.notify).toBeNull();
  });

  it("past_due→activeへの回復はnotifyを返さない(悪化方向のみ通知対象)", async () => {
    const clinic = await createClinic("4");
    const externalSubscriptionId = `sub_recover_${clinic.id}`;

    await billingRepository.applyBillingWebhookEvent(
      subscriptionStatusCommand({
        providerEventId: `evt_create_${clinic.id}`,
        externalSubscriptionId,
        clinicId: clinic.id,
        status: "past_due",
        occurredAt: new Date("2026-09-23T00:00:00Z"),
      })
    );

    const recoverResult = await billingRepository.applyBillingWebhookEvent(
      subscriptionStatusCommand({
        providerEventId: `evt_recover_${clinic.id}`,
        externalSubscriptionId,
        clinicId: clinic.id,
        status: "active",
        occurredAt: new Date("2026-09-23T01:00:00Z"),
      })
    );
    expect(recoverResult.notify).toBeNull();
  });

  it("cancelledへの遷移はnotifyを返す(解約通知)", async () => {
    const clinic = await createClinic("5");
    const externalSubscriptionId = `sub_cancel_${clinic.id}`;

    await billingRepository.applyBillingWebhookEvent(
      subscriptionStatusCommand({
        providerEventId: `evt_create_${clinic.id}`,
        externalSubscriptionId,
        clinicId: clinic.id,
        status: "active",
        occurredAt: new Date("2026-09-23T00:00:00Z"),
      })
    );

    const cancelResult = await billingRepository.applyBillingWebhookEvent(
      subscriptionStatusCommand({
        providerEventId: `evt_cancel_${clinic.id}`,
        externalSubscriptionId,
        clinicId: clinic.id,
        status: "cancelled",
        occurredAt: new Date("2026-09-23T01:00:00Z"),
      })
    );
    expect(cancelResult.notify).toEqual({ clinicId: clinic.id, toStatus: "cancelled" });
  });

  describe("実在しない医院へのWebhook(orphan webhook)", () => {
    // テスト医院のDB削除後に、Stripe側だけ契約が残って後日イベントが届くケース。
    // 契約を再作成しようとして外部キー違反→500→Stripeの無限再送になってはならない。
    const MISSING_CLINIC_ID = "clinic_deleted_before_event";

    it("subscription.updated/deletedは契約を作らず、ignoredとして正常終了する", async () => {
      for (const status of ["active", "past_due", "cancelled"] as const) {
        const providerEventId = `evt_orphan_sub_${status}`;
        const result = await billingRepository.applyBillingWebhookEvent(
          subscriptionStatusCommand({
            providerEventId,
            externalSubscriptionId: `sub_orphan_${status}`,
            clinicId: MISSING_CLINIC_ID,
            status,
            occurredAt: new Date("2026-10-02T00:00:00Z"),
          })
        );
        expect(result).toEqual({ result: "ignored", notify: null });
        expect(await prisma.subscription.count({ where: { clinicId: MISSING_CLINIC_ID } })).toBe(0);
        // 存在しないclinicIdを外部キー付きで保存せず、通知の再送は重複としても扱える形で記録する。
        const recorded = await prisma.billingWebhookEvent.findUnique({ where: { providerEventId } });
        expect(recorded).toEqual(
          expect.objectContaining({ status: "ignored", clinicId: null })
        );
      }
    });

    it("checkout.session.completedも契約を作らずignoredになる", async () => {
      const result = await billingRepository.applyBillingWebhookEvent({
        providerEventId: "evt_orphan_checkout",
        eventType: "checkout.session.completed",
        occurredAt: new Date("2026-10-02T00:00:00Z"),
        action: {
          kind: "checkout_completed",
          identity: {
            externalSubscriptionId: "sub_orphan_checkout",
            clinicId: MISSING_CLINIC_ID,
            plan: "light",
          },
          initialStatus: "trial",
        },
      });
      expect(result.result).toBe("ignored");
      expect(await prisma.subscription.count({ where: { clinicId: MISSING_CLINIC_ID } })).toBe(0);
    });

    it("invoice.paidも契約が無ければignored(契約の新規作成も、Paymentの保存もしない)", async () => {
      const result = await billingRepository.applyBillingWebhookEvent({
        providerEventId: "evt_orphan_invoice",
        eventType: "invoice.paid",
        occurredAt: new Date("2026-10-02T00:00:00Z"),
        action: {
          kind: "invoice_status",
          identity: {
            externalSubscriptionId: "sub_orphan_invoice",
            clinicId: MISSING_CLINIC_ID,
            plan: "light",
          },
          paymentStatus: "paid",
          externalPaymentId: "in_orphan_invoice",
        },
      });
      expect(result.result).toBe("ignored");
      expect(await prisma.payment.count({ where: { externalPaymentId: "in_orphan_invoice" } })).toBe(0);
    });

    it("同じorphanイベントの再送は重複として扱われ、常に正常終了する", async () => {
      const command = subscriptionStatusCommand({
        providerEventId: "evt_orphan_sub_cancelled",
        externalSubscriptionId: "sub_orphan_cancelled",
        clinicId: MISSING_CLINIC_ID,
        status: "cancelled",
        occurredAt: new Date("2026-10-02T00:00:00Z"),
      });
      const result = await billingRepository.applyBillingWebhookEvent(command);
      expect(result.result).toBe("duplicate");
    });
  });
});
