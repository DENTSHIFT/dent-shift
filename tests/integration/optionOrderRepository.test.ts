import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { applyPrismaMigrationsToTestDatabase } from "../helpers/testDatabase";
import type { OptionProductDefinition } from "@/domain/options/optionProductCatalog";

/**
 * OptionOrderRepositoryの実DB(SQLite)結合テスト。
 * diagnosisRepository.test.tsと同じ使い捨てSQLiteパターンを踏襲する。
 * 二重課金・二重生成防止(仕様書Ver1■)が実際にDBレベルで機能することを確認する。
 */

let testDbDir: string;
let repo: typeof import("@/server/db/optionOrderRepository");
let prisma: import("@prisma/client").PrismaClient;

const DEFINITION: OptionProductDefinition = {
  key: "instruction_pdf",
  name: "制作会社向け修正指示書",
  description: "テスト用説明",
  deliveryType: "pdf",
  priceJpy: 3300,
  displayLabel: "3,300円（税込）/ 1件",
};

beforeAll(async () => {
  const testTmpRoot =
    process.platform === "darwin" ? realpathSync("/tmp") : realpathSync(tmpdir());
  testDbDir = mkdtempSync(path.join(testTmpRoot, "dent-shift-option-order-test-db-"));
  const testDbPath = path.join(testDbDir, "test.db");
  process.env.DATABASE_URL = `file:${testDbPath}`;

  applyPrismaMigrationsToTestDatabase(testDbPath);

  repo = await import("@/server/db/optionOrderRepository");
  const clientModule = await import("@/server/db/prismaClient");
  prisma = clientModule.prisma;
}, 60000);

afterAll(async () => {
  await prisma?.$disconnect();
  if (testDbDir) rmSync(testDbDir, { recursive: true, force: true });
});

async function createClinicWithDiagnosis(suffix: string) {
  const clinic = await prisma.clinic.create({
    data: { name: `テスト歯科${suffix}`, url: `https://example${suffix}.com` },
  });
  const diagnosis = await prisma.diagnosis.create({
    data: {
      clinicId: clinic.id,
      totalPoints: 50,
      totalStatus: "partial",
      scoreBreakdownJson: "{}",
      competitorsJson: "[]",
      questionResultsJson: "[]",
      improvementTasksJson: "[]",
      dataDisclaimer: "",
    },
  });
  return { clinic, diagnosis };
}

describe("OptionOrderRepository: 二重課金・二重生成防止", () => {
  it("同一reportId×version×productKeyの注文は使い回し、新規作成しない", async () => {
    const { clinic, diagnosis } = await createClinicWithDiagnosis("-reuse");
    const product = await repo.ensureOptionProduct({
      definition: DEFINITION,
      stripePriceId: "price_test_reuse",
    });

    const first = await repo.createOrReuseDraftOptionOrder({
      clinicId: clinic.id,
      contactId: null,
      productId: product.id,
      productKey: "instruction_pdf",
      reportId: diagnosis.id,
      version: 1,
    });
    const second = await repo.createOrReuseDraftOptionOrder({
      clinicId: clinic.id,
      contactId: null,
      productId: product.id,
      productKey: "instruction_pdf",
      reportId: diagnosis.id,
      version: 1,
    });

    expect(second.id).toBe(first.id);
    const count = await prisma.optionOrder.count({ where: { reportId: diagnosis.id } });
    expect(count).toBe(1);
  });

  it("同一Stripe WebhookイベントIDの二重配信は2回目をduplicateとして処理し、状態を変更しない", async () => {
    const { clinic, diagnosis } = await createClinicWithDiagnosis("-webhook-dup");
    const product = await repo.ensureOptionProduct({
      definition: DEFINITION,
      stripePriceId: "price_test_webhook_dup",
    });
    const order = await repo.createOrReuseDraftOptionOrder({
      clinicId: clinic.id,
      contactId: null,
      productId: product.id,
      productKey: "instruction_pdf",
      reportId: diagnosis.id,
      version: 1,
    });
    await repo.markOptionOrderCheckoutCreated({
      orderId: order.id,
      stripeCheckoutSessionId: "cs_test_webhook_dup",
      amountJpy: 3300,
      priceSnapshot: 3300,
    });

    const command = {
      providerEventId: "evt_test_dup_1",
      eventType: "checkout.session.completed",
      occurredAt: new Date("2026-09-21T00:00:00.000Z"),
      action: {
        kind: "one_time_paid" as const,
        identity: {
          stripeCheckoutSessionId: "cs_test_webhook_dup",
          clinicId: clinic.id,
          reportId: diagnosis.id,
          version: 1,
          optionProductKey: "instruction_pdf",
          improvementActionKey: null,
        },
        stripePaymentIntentId: "pi_test_dup",
        amountTotalJpy: 3300,
      },
    };

    const firstResult = await repo.applyOptionOrderWebhookEvent(command);
    expect(firstResult).toBe("processed");
    const afterFirst = await repo.getOptionOrderById(order.id);
    expect(afterFirst?.status).toBe("generation_queued");
    expect(afterFirst?.paidAt).not.toBeNull();

    // Stripeが同じイベントを再送しても、2回目はduplicateとして扱い、状態を変えない。
    const secondResult = await repo.applyOptionOrderWebhookEvent(command);
    expect(secondResult).toBe("duplicate");
    const afterSecond = await repo.getOptionOrderById(order.id);
    expect(afterSecond?.status).toBe("generation_queued");
    expect(afterSecond?.paidAt?.getTime()).toBe(afterFirst?.paidAt?.getTime());
  });

  it("同じCheckout Sessionに対する異なるイベントIDでの再送も、注文が既にpaid以降ならduplicate扱いにする(二重課金防止)", async () => {
    const { clinic, diagnosis } = await createClinicWithDiagnosis("-webhook-dup2");
    const product = await repo.ensureOptionProduct({
      definition: DEFINITION,
      stripePriceId: "price_test_webhook_dup2",
    });
    const order = await repo.createOrReuseDraftOptionOrder({
      clinicId: clinic.id,
      contactId: null,
      productId: product.id,
      productKey: "instruction_pdf",
      reportId: diagnosis.id,
      version: 1,
    });
    await repo.markOptionOrderCheckoutCreated({
      orderId: order.id,
      stripeCheckoutSessionId: "cs_test_webhook_dup2",
      amountJpy: 3300,
      priceSnapshot: 3300,
    });

    const identity = {
      stripeCheckoutSessionId: "cs_test_webhook_dup2",
      clinicId: clinic.id,
      reportId: diagnosis.id,
      version: 1,
      optionProductKey: "instruction_pdf",
      improvementActionKey: null,
    };

    const first = await repo.applyOptionOrderWebhookEvent({
      providerEventId: "evt_test_dup2_a",
      eventType: "checkout.session.completed",
      occurredAt: new Date("2026-09-21T00:00:00.000Z"),
      action: { kind: "one_time_paid", identity, stripePaymentIntentId: "pi_1", amountTotalJpy: 3300 },
    });
    expect(first).toBe("processed");

    // 別のイベントID(=Stripe側の異常な再送やリトライ)でも、注文が既にpaid以降なら
    // 二重にgeneration_queuedへ書き込んだり課金扱いにしたりしない。
    const second = await repo.applyOptionOrderWebhookEvent({
      providerEventId: "evt_test_dup2_b",
      eventType: "checkout.session.completed",
      occurredAt: new Date("2026-09-21T00:05:00.000Z"),
      action: { kind: "one_time_paid", identity, stripePaymentIntentId: "pi_1", amountTotalJpy: 3300 },
    });
    expect(second).toBe("duplicate");

    const finalOrder = await repo.getOptionOrderById(order.id);
    expect(finalOrder?.status).toBe("generation_queued");
  });

  it("存在しないCheckout Session IDのWebhookはorder_not_foundとして安全に無視する", async () => {
    const result = await repo.applyOptionOrderWebhookEvent({
      providerEventId: "evt_test_missing",
      eventType: "checkout.session.completed",
      occurredAt: new Date("2026-09-21T00:00:00.000Z"),
      action: {
        kind: "one_time_paid",
        identity: {
          stripeCheckoutSessionId: "cs_does_not_exist",
          clinicId: "clinic-missing",
          reportId: "report-missing",
          version: 1,
          optionProductKey: "instruction_pdf",
          improvementActionKey: null,
        },
        stripePaymentIntentId: null,
        amountTotalJpy: 3300,
      },
    });
    expect(result).toBe("order_not_found");
  });
});

describe("OptionOrderRepository: markOptionOrderDownloaded", () => {
  it("available→downloadedへ遷移する", async () => {
    const { clinic, diagnosis } = await createClinicWithDiagnosis("-download-available");
    const product = await repo.ensureOptionProduct({
      definition: DEFINITION,
      stripePriceId: "price_test_download_available",
    });
    const order = await repo.createOrReuseDraftOptionOrder({
      clinicId: clinic.id,
      contactId: null,
      productId: product.id,
      productKey: "instruction_pdf",
      reportId: diagnosis.id,
      version: 1,
    });
    await prisma.optionOrder.update({ where: { id: order.id }, data: { status: "available" } });

    const updated = await repo.markOptionOrderDownloaded(order.id);
    expect(updated.status).toBe("downloaded");
  });

  it("再ダウンロード(downloaded→downloaded)は冪等", async () => {
    const { clinic, diagnosis } = await createClinicWithDiagnosis("-download-idempotent");
    const product = await repo.ensureOptionProduct({
      definition: DEFINITION,
      stripePriceId: "price_test_download_idempotent",
    });
    const order = await repo.createOrReuseDraftOptionOrder({
      clinicId: clinic.id,
      contactId: null,
      productId: product.id,
      productKey: "instruction_pdf",
      reportId: diagnosis.id,
      version: 1,
    });
    await prisma.optionOrder.update({ where: { id: order.id }, data: { status: "downloaded" } });

    const updated = await repo.markOptionOrderDownloaded(order.id);
    expect(updated.status).toBe("downloaded");
  });

  it("completedからは状態を戻さない(将来のcompleted以降フローに影響しない)", async () => {
    const { clinic, diagnosis } = await createClinicWithDiagnosis("-download-completed");
    const product = await repo.ensureOptionProduct({
      definition: DEFINITION,
      stripePriceId: "price_test_download_completed",
    });
    const order = await repo.createOrReuseDraftOptionOrder({
      clinicId: clinic.id,
      contactId: null,
      productId: product.id,
      productKey: "instruction_pdf",
      reportId: diagnosis.id,
      version: 1,
    });
    await prisma.optionOrder.update({ where: { id: order.id }, data: { status: "completed" } });

    const updated = await repo.markOptionOrderDownloaded(order.id);
    expect(updated.status).toBe("completed");
  });
});
