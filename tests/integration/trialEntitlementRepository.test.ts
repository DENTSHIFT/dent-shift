import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { applyPrismaMigrationsToTestDatabase } from "../helpers/testDatabase";

/**
 * TrialEntitlement予約〜消費のライフサイクルを、実際のSQLite DB(部分ユニークインデックス
 * 込み)に対して検証する結合テスト。PO指示6の「同時実行テストは競合状態を再現して確認」を
 * 満たすため、実際に複数のPromiseを並行実行して部分ユニークインデックスの実動作を確認する。
 */

let testDbDir: string;
let repo: typeof import("@/server/db/trialEntitlementRepository");
let prisma: import("@prisma/client").PrismaClient;

beforeAll(async () => {
  const testTmpRoot =
    process.platform === "darwin" ? realpathSync("/tmp") : realpathSync(tmpdir());
  testDbDir = mkdtempSync(path.join(testTmpRoot, "dent-shift-trial-entitlement-test-db-"));
  const testDbPath = path.join(testDbDir, "test.db");
  process.env.DATABASE_URL = `file:${testDbPath}`;

  applyPrismaMigrationsToTestDatabase(testDbPath);

  repo = await import("@/server/db/trialEntitlementRepository");
  const clientModule = await import("@/server/db/prismaClient");
  prisma = clientModule.prisma;
}, 60000);

afterAll(async () => {
  await prisma?.$disconnect();
  if (testDbDir) rmSync(testDbDir, { recursive: true, force: true });
});

async function createClinic(suffix: string) {
  return prisma.clinic.create({
    data: { name: `トライアル権利テスト歯科${suffix}`, url: `https://trial-entitlement-test${suffix}.example.com` },
  });
}

describe("reserveTrialEntitlement", () => {
  it("初回対象医院は新規予約を作成できる", async () => {
    const clinic = await createClinic("-fresh");
    const result = await repo.reserveTrialEntitlement({ clinicId: clinic.id });
    expect(result.outcome).toBe("reserved");
  });

  it("Clinic.trialConsumedAtが設定済みの医院は予約できない(already_consumed)", async () => {
    const clinic = await createClinic("-consumed-clinic");
    await prisma.clinic.update({ where: { id: clinic.id }, data: { trialConsumedAt: new Date() } });
    const result = await repo.reserveTrialEntitlement({ clinicId: clinic.id });
    expect(result.outcome).toBe("already_consumed");
  });

  it("statusがconsumedのEntitlementが存在する医院は予約できない(defense-in-depth)", async () => {
    const clinic = await createClinic("-consumed-entitlement");
    await prisma.trialEntitlement.create({
      data: {
        clinicId: clinic.id,
        status: "consumed",
        reservationExpiresAt: new Date(Date.now() + 10_000),
        consumedAt: new Date(),
      },
    });
    const result = await repo.reserveTrialEntitlement({ clinicId: clinic.id });
    expect(result.outcome).toBe("already_consumed");
  });

  it("同一医院に対する同時リクエストで実際に1件だけ予約が作られる(部分ユニークインデックスの実動作、競合状態の再現)", async () => {
    const clinic = await createClinic("-race");
    const results = await Promise.all([
      repo.reserveTrialEntitlement({ clinicId: clinic.id }),
      repo.reserveTrialEntitlement({ clinicId: clinic.id }),
      repo.reserveTrialEntitlement({ clinicId: clinic.id }),
    ]);

    const reservedResults = results.filter((r) => r.outcome === "reserved");
    expect(reservedResults.length).toBe(1);
    const nonReservedResults = results.filter((r) => r.outcome !== "reserved");
    expect(nonReservedResults.length).toBe(2);
    for (const r of nonReservedResults) {
      expect(["reservation_in_progress", "existing_session"]).toContain(r.outcome);
    }

    const activeCount = await prisma.trialEntitlement.count({
      where: { clinicId: clinic.id, status: "reserved" },
    });
    expect(activeCount).toBe(1);
  });

  it("checkoutSessionIdが設定済みの有効な予約への再試行はexisting_sessionを返す(安全な再試行の再利用)", async () => {
    const clinic = await createClinic("-existing-session");
    const first = await repo.reserveTrialEntitlement({ clinicId: clinic.id });
    if (first.outcome !== "reserved") throw new Error("setup failed");
    await repo.attachStripeSessionToReservation({
      entitlementId: first.entitlementId,
      ownerToken: first.ownerToken,
      checkoutSessionId: "cs_reuse_test",
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });

    const retry = await repo.reserveTrialEntitlement({ clinicId: clinic.id });
    expect(retry).toEqual({
      outcome: "existing_session",
      entitlementId: first.entitlementId,
      checkoutSessionId: "cs_reuse_test",
    });
  });

  it("2026-09-28追加(PO再指摘): checkoutSessionId設定済みでも、保存済みのreservationExpiresAtが過去(Stripe側のexpires_atが実際に経過した)なら、existing_sessionとして再利用せずreleasedへ遷移し、新規予約を作成できる(status===openの確認だけに頼らない)", async () => {
    const clinic = await createClinic("-session-actually-expired");
    const first = await repo.reserveTrialEntitlement({ clinicId: clinic.id });
    if (first.outcome !== "reserved") throw new Error("setup failed");
    // Stripeが返したexpires_atが既に過去、という状況を再現する
    // (attachStripeSessionToReservation経由ではなく、実際にexpires_atが経過した状態を
    // 直接作る)。
    await prisma.trialEntitlement.update({
      where: { id: first.entitlementId },
      data: {
        checkoutSessionId: "cs_actually_expired",
        reservationExpiresAt: new Date(Date.now() - 1000),
      },
    });

    const retry = await repo.reserveTrialEntitlement({ clinicId: clinic.id });
    expect(retry.outcome).toBe("reserved");

    const oldRow = await prisma.trialEntitlement.findUnique({ where: { id: first.entitlementId } });
    expect(oldRow?.status).toBe("released");
  });

  it("期限切れの予約はreleasedへ遷移し、新規予約が作成できる", async () => {
    const clinic = await createClinic("-expired");
    const expired = await prisma.trialEntitlement.create({
      data: {
        clinicId: clinic.id,
        status: "reserved",
        reservationExpiresAt: new Date(Date.now() - 60_000),
        reservationOwnerToken: "stale-token",
      },
    });

    const result = await repo.reserveTrialEntitlement({ clinicId: clinic.id });
    expect(result.outcome).toBe("reserved");

    const refreshedExpired = await prisma.trialEntitlement.findUnique({ where: { id: expired.id } });
    expect(refreshedExpired?.status).toBe("released");
    expect(refreshedExpired?.releasedAt).not.toBeNull();
  });
});

describe("attachStripeSessionToReservation / releaseOwnReservation", () => {
  it("所有者(正しいownerToken)だけが予約を更新・解放できる", async () => {
    const clinic = await createClinic("-owner-guard");
    const reserved = await repo.reserveTrialEntitlement({ clinicId: clinic.id });
    if (reserved.outcome !== "reserved") throw new Error("setup failed");

    const attachedWithWrongToken = await repo.attachStripeSessionToReservation({
      entitlementId: reserved.entitlementId,
      ownerToken: "not-the-real-token",
      checkoutSessionId: "cs_should_not_attach",
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(attachedWithWrongToken).toBe(false);

    await repo.releaseOwnReservation({
      entitlementId: reserved.entitlementId,
      ownerToken: "not-the-real-token",
    });
    const stillReserved = await prisma.trialEntitlement.findUnique({
      where: { id: reserved.entitlementId },
    });
    expect(stillReserved?.status).toBe("reserved");

    const attached = await repo.attachStripeSessionToReservation({
      entitlementId: reserved.entitlementId,
      ownerToken: reserved.ownerToken,
      checkoutSessionId: "cs_correct",
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(attached).toBe(true);
  });

  it("Stripe API失敗を模した解放では、自分の予約だけがreleasedになる(他医院・他の予約は無傷)", async () => {
    const clinicA = await createClinic("-release-a");
    const clinicB = await createClinic("-release-b");
    const reservedA = await repo.reserveTrialEntitlement({ clinicId: clinicA.id });
    const reservedB = await repo.reserveTrialEntitlement({ clinicId: clinicB.id });
    if (reservedA.outcome !== "reserved" || reservedB.outcome !== "reserved") {
      throw new Error("setup failed");
    }

    await repo.releaseOwnReservation({
      entitlementId: reservedA.entitlementId,
      ownerToken: reservedA.ownerToken,
    });

    const a = await prisma.trialEntitlement.findUnique({ where: { id: reservedA.entitlementId } });
    const b = await prisma.trialEntitlement.findUnique({ where: { id: reservedB.entitlementId } });
    expect(a?.status).toBe("released");
    expect(b?.status).toBe("reserved");

    // 解放後、この医院は再予約できる。
    const reReserved = await repo.reserveTrialEntitlement({ clinicId: clinicA.id });
    expect(reReserved.outcome).toBe("reserved");
  });
});

describe("consumeTrialEntitlementFromWebhook", () => {
  async function reserveAndAttach(clinicId: string, checkoutSessionId: string) {
    const reserved = await repo.reserveTrialEntitlement({ clinicId });
    if (reserved.outcome !== "reserved") throw new Error("setup failed");
    await repo.attachStripeSessionToReservation({
      entitlementId: reserved.entitlementId,
      ownerToken: reserved.ownerToken,
      checkoutSessionId,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });
    return reserved.entitlementId;
  }

  it("正常系: reserved→consumedとなり、Clinic.trialConsumedAtが設定される", async () => {
    const clinic = await createClinic("-consume-ok");
    const entitlementId = await reserveAndAttach(clinic.id, "cs_consume_ok");

    const result = await repo.consumeTrialEntitlementFromWebhook({
      trialEntitlementId: entitlementId,
      clinicId: clinic.id,
      checkoutSessionId: "cs_consume_ok",
      externalSubscriptionId: "sub_consume_ok",
      occurredAt: new Date("2026-09-27T00:00:00Z"),
    });
    expect(result).toEqual({
      result: "consumed",
      trialActivatedNow: true,
      integrationEventId: expect.any(String),
    });

    const entitlement = await prisma.trialEntitlement.findUnique({ where: { id: entitlementId } });
    expect(entitlement?.status).toBe("consumed");
    expect(entitlement?.externalSubscriptionId).toBe("sub_consume_ok");

    const clinicAfter = await prisma.clinic.findUnique({ where: { id: clinic.id } });
    expect(clinicAfter?.trialConsumedAt?.toISOString()).toBe("2026-09-27T00:00:00.000Z");
  });

  it("metadataのclinicIdが不一致なら消費しない", async () => {
    const clinic = await createClinic("-mismatch-clinic");
    const otherClinic = await createClinic("-mismatch-clinic-other");
    const entitlementId = await reserveAndAttach(clinic.id, "cs_mismatch_clinic");

    const result = await repo.consumeTrialEntitlementFromWebhook({
      trialEntitlementId: entitlementId,
      clinicId: otherClinic.id,
      checkoutSessionId: "cs_mismatch_clinic",
      externalSubscriptionId: "sub_mismatch_clinic",
      occurredAt: new Date(),
    });
    expect(result.result).toBe("not_found_or_mismatch");

    const entitlement = await prisma.trialEntitlement.findUnique({ where: { id: entitlementId } });
    expect(entitlement?.status).toBe("reserved");
  });

  it("Checkout Session IDが不一致なら消費しない", async () => {
    const clinic = await createClinic("-mismatch-session");
    const entitlementId = await reserveAndAttach(clinic.id, "cs_actual_session");

    const result = await repo.consumeTrialEntitlementFromWebhook({
      trialEntitlementId: entitlementId,
      clinicId: clinic.id,
      checkoutSessionId: "cs_wrong_session",
      externalSubscriptionId: "sub_mismatch_session",
      occurredAt: new Date(),
    });
    expect(result.result).toBe("not_found_or_mismatch");
  });

  it("即時課金(トライアルなし)Subscriptionでは消費しない(そもそもtrialEntitlementIdを渡さない設計。存在しないIDを渡すケースを模す)", async () => {
    const clinic = await createClinic("-immediate-charge");
    const result = await repo.consumeTrialEntitlementFromWebhook({
      trialEntitlementId: "nonexistent-entitlement-id",
      clinicId: clinic.id,
      checkoutSessionId: "cs_immediate",
      externalSubscriptionId: "sub_immediate",
      occurredAt: new Date(),
    });
    expect(result.result).toBe("not_found_or_mismatch");
  });

  it("同一Webhookの再送(同一externalSubscriptionId)は冪等に成功扱いになり、二重消費・trialActivatedNowの再発火をしない", async () => {
    const clinic = await createClinic("-idempotent-resend");
    const entitlementId = await reserveAndAttach(clinic.id, "cs_idempotent");

    const first = await repo.consumeTrialEntitlementFromWebhook({
      trialEntitlementId: entitlementId,
      clinicId: clinic.id,
      checkoutSessionId: "cs_idempotent",
      externalSubscriptionId: "sub_idempotent",
      occurredAt: new Date("2026-09-27T00:00:00Z"),
    });
    expect(first).toEqual({
      result: "consumed",
      trialActivatedNow: true,
      integrationEventId: expect.any(String),
    });

    const second = await repo.consumeTrialEntitlementFromWebhook({
      trialEntitlementId: entitlementId,
      clinicId: clinic.id,
      checkoutSessionId: "cs_idempotent",
      externalSubscriptionId: "sub_idempotent",
      occurredAt: new Date("2026-09-27T00:05:00Z"),
    });
    expect(second).toEqual({
      result: "already_consumed_idempotent",
      trialActivatedNow: false,
      integrationEventId: null,
    });
  });

  it("異なるWebhookが同じ既に消費済みのEntitlementを別のSubscription IDで消費しようとしても衝突として拒否する(二重消費防止)", async () => {
    const clinic = await createClinic("-conflict-sub");
    const entitlementId = await reserveAndAttach(clinic.id, "cs_conflict");
    await repo.consumeTrialEntitlementFromWebhook({
      trialEntitlementId: entitlementId,
      clinicId: clinic.id,
      checkoutSessionId: "cs_conflict",
      externalSubscriptionId: "sub_original",
      occurredAt: new Date(),
    });

    const conflicting = await repo.consumeTrialEntitlementFromWebhook({
      trialEntitlementId: entitlementId,
      clinicId: clinic.id,
      checkoutSessionId: "cs_conflict",
      externalSubscriptionId: "sub_different",
      occurredAt: new Date(),
    });
    expect(conflicting.result).toBe("not_found_or_mismatch");

    const entitlement = await prisma.trialEntitlement.findUnique({ where: { id: entitlementId } });
    expect(entitlement?.externalSubscriptionId).toBe("sub_original");
  });

  it("Clinic.trialConsumedAtが既に設定済みの場合は上書きしない(一方向)", async () => {
    const clinic = await createClinic("-no-overwrite");
    const earlier = new Date("2026-01-01T00:00:00Z");
    await prisma.clinic.update({ where: { id: clinic.id }, data: { trialConsumedAt: earlier } });
    // 通常はtrialConsumedAt設定済みの医院はreserveTrialEntitlementで弾かれるが、
    // ここでは「既に別経路で先にconsumedAtが立っていた」異常系を直接再現する。
    const entitlement = await prisma.trialEntitlement.create({
      data: {
        clinicId: clinic.id,
        status: "reserved",
        reservationExpiresAt: new Date(Date.now() + 60_000),
        checkoutSessionId: "cs_no_overwrite",
      },
    });

    const result = await repo.consumeTrialEntitlementFromWebhook({
      trialEntitlementId: entitlement.id,
      clinicId: clinic.id,
      checkoutSessionId: "cs_no_overwrite",
      externalSubscriptionId: "sub_no_overwrite",
      occurredAt: new Date("2026-09-27T00:00:00Z"),
    });
    expect(result).toEqual({
      result: "consumed",
      trialActivatedNow: false,
      integrationEventId: expect.any(String),
    });

    const clinicAfter = await prisma.clinic.findUnique({ where: { id: clinic.id } });
    expect(clinicAfter?.trialConsumedAt?.toISOString()).toBe(earlier.toISOString());
  });

  it("解約(released)後の再Checkoutでは、その解放済みEntitlementは二度と消費できない", async () => {
    const clinic = await createClinic("-released-no-reuse");
    const reserved = await repo.reserveTrialEntitlement({ clinicId: clinic.id });
    if (reserved.outcome !== "reserved") throw new Error("setup failed");
    await repo.releaseOwnReservation({
      entitlementId: reserved.entitlementId,
      ownerToken: reserved.ownerToken,
    });

    const result = await repo.consumeTrialEntitlementFromWebhook({
      trialEntitlementId: reserved.entitlementId,
      clinicId: clinic.id,
      checkoutSessionId: "cs_never_attached",
      externalSubscriptionId: "sub_released_no_reuse",
      occurredAt: new Date(),
    });
    expect(result.result).toBe("not_found_or_mismatch");
  });

  it("2026-09-28追加(PO再指摘): 別経路(Subscription状態遷移検知)が同じdedupeKeyでtrial_activatedイベントを先に記録していても、消費自体は成功しイベントは二重記録されない", async () => {
    const clinic = await createClinic("-dedupe-collision");
    const entitlementId = await reserveAndAttach(clinic.id, "cs_dedupe_collision");
    const externalSubscriptionId = "sub_dedupe_collision";

    // 別経路(billingRepository.ts側)が先にtrial_activatedを記録済み、という状況を再現する。
    await prisma.integrationEvent.create({
      data: {
        eventType: "trial_activated",
        clinicId: clinic.id,
        payloadJson: "{}",
        status: "pending",
        dedupeKey: `trial_activated:${externalSubscriptionId}`,
      },
    });

    const result = await repo.consumeTrialEntitlementFromWebhook({
      trialEntitlementId: entitlementId,
      clinicId: clinic.id,
      checkoutSessionId: "cs_dedupe_collision",
      externalSubscriptionId,
      occurredAt: new Date(),
    });
    // 消費自体(reserved→consumed、Clinic.trialConsumedAt)は成功する。
    expect(result.result).toBe("consumed");
    // だが新規にIntegrationEvent行は作られない(dedupeKeyの一意制約でスキップされた)。
    expect(result.integrationEventId).toBeNull();

    const eventCount = await prisma.integrationEvent.count({
      where: { dedupeKey: `trial_activated:${externalSubscriptionId}` },
    });
    expect(eventCount).toBe(1);
  });
});
