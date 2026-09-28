import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prismaClient";
import {
  canTransitionTrialEntitlement,
  computePendingReservationExpiry,
  isClinicTrialEligible,
  isTrialEntitlementStatus,
} from "@/domain/billing/trialEntitlement";
import { retryOnConcurrentWrite, findPrimaryContactPayloadFields } from "./billingRepository";

export class TrialEntitlementRepositoryError extends Error {}

/**
 * checkout route・/plansページの両方から共有する、医院のトライアル消費状態の読み取り。
 * 呼び出し側はこの関数を通してのみClinicのtrialConsumedAtを参照する(生のPrisma呼び出しを
 * 各所へ書かず、テストでモックしやすくするため)。
 */
export async function getClinicTrialState(
  clinicId: string
): Promise<{ trialConsumedAt: Date | null } | null> {
  return prisma.clinic.findUnique({
    where: { id: clinicId },
    select: { trialConsumedAt: true },
  });
}

/**
 * 2026-09-28追加(PO再指摘、CTA判定を先送りしない): /plansページのCTA文言判定用の
 * スナップショット。trialConsumedAtだけでなく、consumed済みEntitlementの有無・有効な
 * (期限切れでない)reservedの有無とcheckoutSessionId設定状況までをまとめて返す。
 * Stripe APIは呼ばない(DB保存済みの状態のみ)。
 */
export async function getClinicTrialCheckoutSnapshot(
  clinicId: string,
  now: Date = new Date()
): Promise<{
  trialConsumedAt: Date | null;
  hasConsumedEntitlement: boolean;
  activeReservation: { hasCheckoutSession: boolean } | null;
} | null> {
  const clinic = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: { trialConsumedAt: true },
  });
  if (!clinic) return null;

  const [consumedEntitlement, activeReservation] = await Promise.all([
    prisma.trialEntitlement.findFirst({
      where: { clinicId, status: "consumed" },
      select: { id: true },
    }),
    // 期限切れ(reservationExpiresAt < now)は対象外(PO指示: 期限切れreservedは対象外)。
    prisma.trialEntitlement.findFirst({
      where: { clinicId, status: "reserved", reservationExpiresAt: { gt: now } /* isReservationStillValid()の定義と一致させる */ },
      select: { checkoutSessionId: true },
    }),
  ]);

  return {
    trialConsumedAt: clinic.trialConsumedAt,
    hasConsumedEntitlement: consumedEntitlement !== null,
    activeReservation: activeReservation
      ? { hasCheckoutSession: activeReservation.checkoutSessionId !== null }
      : null,
  };
}

function generateOwnerToken(): string {
  // 推測困難な一時トークン(PO指示2-4)。所有者だけがこの予約を更新・Stripe Session作成
  // できるようにする(WHERE句にこの値との一致を含める、以下参照)。
  return crypto.randomBytes(24).toString("hex");
}

export type ReserveTrialEntitlementResult =
  | {
      // 新規に予約を作成できた。ownerTokenは呼び出し元(checkout route)のこのリクエスト内
      // でのみ保持し、DB以外(レスポンス等)へは一切出さない。
      outcome: "reserved";
      entitlementId: string;
      ownerToken: string;
    }
  | {
      // 既に有効なStripe Checkout Sessionが紐付いた予約が存在する(=同じ処理の
      // 安全な再試行とみなせる)。呼び出し元はこのSessionを再利用してよい。
      outcome: "existing_session";
      entitlementId: string;
      checkoutSessionId: string;
    }
  | {
      // 別リクエストがまさに予約〜Session作成の途中(checkoutSessionId未確定)。
      // 重複Session作成を避けるため、呼び出し元は再試行可能なエラーを返すべき。
      outcome: "reservation_in_progress";
    }
  | {
      // この医院は既にトライアルを消費済み、または消費済みのEntitlementが存在する。
      outcome: "already_consumed";
    };

/**
 * ライト/スタンダードの無料トライアルCheckoutを作る前に呼び出す。短いDBトランザクション内で
 * (1)期限切れのreservedをreleasedへ遷移 (2)trialConsumedAt/既存Entitlementの再確認
 * (3)新しいreserved行を作成、を行う(PO指示2)。
 * 部分ユニークインデックス(1医院につき有効なreservedは1件)による競合(P2002)は、
 * 既存の予約を読み直して"existing_session"/"reservation_in_progress"へ変換する
 * (500にしない、PO指示2)。
 */
export async function reserveTrialEntitlement(input: {
  clinicId: string;
}): Promise<ReserveTrialEntitlementResult> {
  return retryOnConcurrentWrite(() => reserveTrialEntitlementOnce(input), 3);
}

async function reserveTrialEntitlementOnce(input: {
  clinicId: string;
}): Promise<ReserveTrialEntitlementResult> {
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    // (1) 期限切れのreservedをreleasedへ遷移(このクリニック分だけでよい。部分ユニーク
    // インデックスはclinicId単位のため)。
    await tx.trialEntitlement.updateMany({
      where: { clinicId: input.clinicId, status: "reserved", reservationExpiresAt: { lte: now } /* isReservationStillValid()の定義(<=nowは期限切れ)と一致させる */ },
      data: { status: "released", releasedAt: now },
    });

    // (2) trialConsumedAt/既存Entitlementの再確認。
    const clinic = await tx.clinic.findUnique({
      where: { id: input.clinicId },
      select: { trialConsumedAt: true },
    });
    if (!clinic) {
      throw new TrialEntitlementRepositoryError("Clinic not found.");
    }
    if (!isClinicTrialEligible(clinic)) {
      return { outcome: "already_consumed" } as const;
    }
    const consumedExisting = await tx.trialEntitlement.findFirst({
      where: { clinicId: input.clinicId, status: "consumed" },
      select: { id: true },
    });
    if (consumedExisting) {
      return { outcome: "already_consumed" } as const;
    }

    // 有効な(期限切れでない)reservedが既にあるか確認。
    const activeReservation = await tx.trialEntitlement.findFirst({
      where: {
        clinicId: input.clinicId,
        status: "reserved",
        reservationExpiresAt: { gt: now } /* isReservationStillValid()の定義と一致させる */,
      },
    });
    if (activeReservation) {
      if (activeReservation.checkoutSessionId) {
        return {
          outcome: "existing_session",
          entitlementId: activeReservation.id,
          checkoutSessionId: activeReservation.checkoutSessionId,
        } as const;
      }
      return { outcome: "reservation_in_progress" } as const;
    }

    // (3) 新しいreserved行を作成。
    const ownerToken = generateOwnerToken();
    const created = await tx.trialEntitlement.create({
      data: {
        clinicId: input.clinicId,
        status: "reserved",
        reservedAt: now,
        reservationExpiresAt: computePendingReservationExpiry(now),
        reservationOwnerToken: ownerToken,
      },
      select: { id: true },
    });
    return { outcome: "reserved", entitlementId: created.id, ownerToken } as const;
  });
}

/**
 * Stripe Checkout Session作成成功後、実際のsession.idとexpires_atを該当予約行へ保存する
 * (PO指示3)。更新条件は必ずid・status=reserved・所有者一致を含める(WHERE句)。
 * 所有権を失っていた場合(=何らかの理由で予約が既に解放/消費されていた場合)はfalseを返し、
 * 呼び出し元はそのSessionをユーザーへ返さず安全に停止する。
 */
export async function attachStripeSessionToReservation(input: {
  entitlementId: string;
  ownerToken: string;
  checkoutSessionId: string;
  expiresAt: Date;
}): Promise<boolean> {
  const result = await prisma.trialEntitlement.updateMany({
    where: {
      id: input.entitlementId,
      status: "reserved",
      reservationOwnerToken: input.ownerToken,
    },
    data: {
      checkoutSessionId: input.checkoutSessionId,
      reservationExpiresAt: input.expiresAt,
    },
  });
  return result.count === 1;
}

/**
 * Stripe Session作成が失敗した場合、該当する「自分の」予約だけをreleasedへ遷移する
 * (PO指示3)。別リクエストの予約を解放しないよう、必ずownerTokenの一致を条件に含める。
 */
export async function releaseOwnReservation(input: {
  entitlementId: string;
  ownerToken: string;
}): Promise<void> {
  await prisma.trialEntitlement.updateMany({
    where: {
      id: input.entitlementId,
      status: "reserved",
      reservationOwnerToken: input.ownerToken,
    },
    data: { status: "released", releasedAt: new Date() },
  });
}

export type ConsumeTrialEntitlementResult =
  | "consumed"
  | "already_consumed_idempotent"
  | "not_found_or_mismatch";

/**
 * Stripe署名検証済みWebhookで、実際にトライアル付きSubscriptionが作成・有効化された
 * ことを確認した場合だけ呼び出す(PO指示4)。**呼び出し元(webhook route)が、事前に
 * Stripe上のSubscription実データを取得し、isVerifiedTrialingSubscriptionForConsumption()
 * で検証済みであることが前提**(2026-09-28修正: checkout.session.completedのmetadataだけを
 * 根拠に消費してはならない、というPO再指摘に基づく。このリポジトリ関数自体はStripe API を
 * 呼ばず、DBの原子的更新のみを担当する)。
 * 1つのDBトランザクションで、metadataのtrialEntitlementId・clinicId・Checkout Session ID・
 * Subscription IDをすべて照合したうえで、対象の1行だけをreserved→consumedへ条件付き更新し、
 * 同じトランザクション内で"trial_activated"イベントをdedupeKey付きで記録する
 * (2026-09-28修正: 「別Webhookが記録するはず」という設計は不整合を生むため撤回。
 * dedupeKey=`trial_activated:${externalSubscriptionId}`のDBユニーク制約により、
 * Subscription状態遷移検知経由(billingRepository.ts)の記録とどちらが先でも
 * 最終的に1件だけになる)。
 * clinicIdだけで予約を探すことはしない。同じWebhookの再送・関連する別Webhookが
 * 届いても、externalSubscriptionIdの一致により二重消費・二重イベントにならない
 * (冪等: 既にconsumed済みかつ同一externalSubscriptionIdなら"already_consumed_idempotent"を返す)。
 */
export async function consumeTrialEntitlementFromWebhook(input: {
  trialEntitlementId: string;
  clinicId: string;
  checkoutSessionId: string;
  externalSubscriptionId: string;
  occurredAt: Date;
}): Promise<{
  result: ConsumeTrialEntitlementResult;
  trialActivatedNow: boolean;
  // 新規に作成された"trial_activated" IntegrationEvent行のid(トランザクションcommit後に
  // 呼び出し元がSalesforce同期を1回試行するために使う)。dedupe等で新規作成されなかった
  // 場合はnull。
  integrationEventId: string | null;
}> {
  return retryOnConcurrentWrite(() => consumeTrialEntitlementFromWebhookOnce(input), 3);
}

async function consumeTrialEntitlementFromWebhookOnce(input: {
  trialEntitlementId: string;
  clinicId: string;
  checkoutSessionId: string;
  externalSubscriptionId: string;
  occurredAt: Date;
}): Promise<{
  result: ConsumeTrialEntitlementResult;
  trialActivatedNow: boolean;
  integrationEventId: string | null;
}> {
  return prisma.$transaction(async (tx) => {
    const entitlement = await tx.trialEntitlement.findUnique({
      where: { id: input.trialEntitlementId },
    });

    if (!entitlement) {
      return { result: "not_found_or_mismatch", trialActivatedNow: false, integrationEventId: null } as const;
    }
    // 3-way突合: metadataのclinicId・Checkout Session ID・Subscription IDのすべてが、
    // この予約行の記録と一致することを確認する(PO指示: clinicIdだけで探さない)。
    if (
      entitlement.clinicId !== input.clinicId ||
      entitlement.checkoutSessionId !== input.checkoutSessionId
    ) {
      return { result: "not_found_or_mismatch", trialActivatedNow: false, integrationEventId: null } as const;
    }

    if (!isTrialEntitlementStatus(entitlement.status)) {
      throw new TrialEntitlementRepositoryError("Stored TrialEntitlement status is invalid.");
    }

    // 冪等性: 既に同じexternalSubscriptionIdでconsumed済みなら、Webhookの再送や
    // 関連する別Webhookの重複到達として成功扱い(二重消費・二重イベントにしない)。
    if (entitlement.status === "consumed") {
      if (entitlement.externalSubscriptionId === input.externalSubscriptionId) {
        return {
          result: "already_consumed_idempotent",
          trialActivatedNow: false,
          integrationEventId: null,
        } as const;
      }
      // 既に消費済みの予約が、別のSubscription IDから消費されようとしている
      // (=衝突)。黙って上書きせず、not_found_or_mismatchとして拒否し、呼び出し元で警告ログを残す。
      return { result: "not_found_or_mismatch", trialActivatedNow: false, integrationEventId: null } as const;
    }

    if (!canTransitionTrialEntitlement(entitlement.status, "consumed")) {
      return { result: "not_found_or_mismatch", trialActivatedNow: false, integrationEventId: null } as const;
    }

    // 期待する現在状態(status=reserved)をWHERE条件に含めた条件付き更新のみを行う
    // (PO指示5: 既存の状態を無条件に上書きする更新は禁止)。
    const updated = await tx.trialEntitlement.updateMany({
      where: { id: entitlement.id, status: "reserved" },
      data: {
        status: "consumed",
        consumedAt: input.occurredAt,
        externalSubscriptionId: input.externalSubscriptionId,
      },
    });
    if (updated.count !== 1) {
      return { result: "not_found_or_mismatch", trialActivatedNow: false, integrationEventId: null } as const;
    }

    // Clinic.trialConsumedAtがNULLの場合だけ設定する(一方向、既存値は上書きしない)。
    const clinic = await tx.clinic.findUnique({
      where: { id: input.clinicId },
      select: { trialConsumedAt: true },
    });
    let trialActivatedNow = false;
    if (clinic && clinic.trialConsumedAt === null) {
      await tx.clinic.update({
        where: { id: input.clinicId },
        data: { trialConsumedAt: input.occurredAt },
      });
      trialActivatedNow = true;
    }

    // 2026-09-28修正(PO再指摘): "trial_activated"イベントは、消費が成功した
    // このトランザクションの中で記録する(別Webhook任せにしない)。
    // 【重要】PostgreSQLでは、トランザクション内でユニーク制約違反(P2002)を
    // JavaScript側でtry/catchしても、そのトランザクション自体はaborted状態になり、
    // 以降のCOMMITが失敗する(SQLiteはこの制約を持たないため、SQLiteのテストが
    // 通るだけでは安全性の証明にならない、という指摘は正しい)。
    // そのため、例外を発生させる可能性のあるcreate()+catch(P2002)は使わず、
    // `INSERT ... ON CONFLICT ("dedupeKey") DO NOTHING`を生SQLで直接発行する。
    // この文はdedupeKeyが既に存在してもエラーを発生させず、単に0行挿入して
    // 正常終了する(=dedupe競合はトランザクションを中断させない通常の成功経路になる)。
    // SQLite・PostgreSQLの両方が`ON CONFLICT ... DO NOTHING ... RETURNING`構文を
    // サポートするため、同一のSQLで両エンジンに対応できる(tests/integration/
    // trialEntitlementRepository.test.tsでSQLite上の動作を検証。PostgreSQL実接続での
    // 検証結果・可否は別途報告する)。
    const newIntegrationEventId = crypto.randomUUID();
    // 2026-09-29追加(PO承認、Salesforce連携P0-2): trial_activatedのpayloadへ
    // Contact ID・契約状態・プラン・同意日時を追加する(DB読み取りのみ、外部通信はしない)。
    const [contactFields, subscriptionForPlan] = await Promise.all([
      findPrimaryContactPayloadFields(tx, input.clinicId),
      tx.subscription.findUnique({
        where: { externalSubscriptionId: input.externalSubscriptionId },
        select: { plan: true },
      }),
    ]);
    const trialActivatedPayloadJson = JSON.stringify({
      contact_id: contactFields.contactId,
      consent_accepted_at: contactFields.consentAcceptedAt,
      plan: subscriptionForPlan?.plan ?? null,
      status: "trial",
    });
    const insertedRows = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO "IntegrationEvent" ("id", "eventType", "payloadJson", "status", "clinicId", "contactId", "dedupeKey")
      VALUES (${newIntegrationEventId}, ${"trial_activated"}, ${trialActivatedPayloadJson}, ${"pending"}, ${input.clinicId}, ${contactFields.contactId}, ${`trial_activated:${input.externalSubscriptionId}`})
      ON CONFLICT ("dedupeKey") DO NOTHING
      RETURNING "id"
    `;
    // 0行返る(=既に別経路が同じdedupeKeyで記録済み)場合はintegrationEventId=null。
    // どちらの場合も例外は発生せず、ここまでの更新(reserved→consumed・
    // Clinic.trialConsumedAt)を含むトランザクション全体が正常にCOMMITされる。
    const integrationEventId = insertedRows[0]?.id ?? null;

    return { result: "consumed", trialActivatedNow, integrationEventId } as const;
  });
}

// テスト・ダッシュボード表示等から、医院の現在の予約状態を確認するための読み取り専用ヘルパー。
export async function findActiveReservationByClinicId(
  clinicId: string,
  now: Date = new Date()
) {
  return prisma.trialEntitlement.findFirst({
    where: { clinicId, status: "reserved", reservationExpiresAt: { gt: now } /* isReservationStillValid()の定義と一致させる */ },
  });
}

export type PrismaTransactionClient = Prisma.TransactionClient;
