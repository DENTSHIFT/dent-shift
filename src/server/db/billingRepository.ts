import crypto from "node:crypto";
import { prisma } from "./prismaClient";
import {
  canTransitionSubscription,
  isSubscriptionStatus,
  type SubscriptionStatus,
} from "@/domain/billing/subscriptionStatus";
import { isPlanId, type PlanId } from "@/domain/billing/planCatalog";
import type { Prisma } from "@prisma/client";
import type {
  BillingStatusNotification,
  BillingWebhookApplyOutcome,
  BillingWebhookApplyResult,
  BillingWebhookCommand,
  BillingWebhookIdentity,
  SubscriptionActivatedSignal,
  SubscriptionCanceledSignal,
  TrialActivatedSignal,
} from "@/domain/billing/billingWebhook";
import { confirmAttributionForClinic } from "./ambassadorRepository";

// 契約状態がここに遷移した時点でユーザーへメール通知する(解約はcancelledで別文面)。
const NOTIFY_ON_STATUSES: readonly SubscriptionStatus[] = [
  "past_due",
  "restricted",
  "suspended",
  "cancelled",
];

export class BillingRepositoryStateError extends Error {}

// Prismaの対話型トランザクションは既定5秒でタイムアウトする(P2028)。2026-09-26のtest E2Eで
// Webhookが遅延・500になる事象があり、原因は未確定(P2028やリージョン間遅延の可能性)だが、
// 余裕を持たせるためtimeoutを延長した。
const WEBHOOK_TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const;

export async function createSubscriptionRecord(input: {
  clinicId: string;
  plan: PlanId;
  status: SubscriptionStatus;
  externalSubscriptionId: string;
  // 招待経由(パイロット/1円モニター)で作成された契約の追跡用。通常契約は未指定。
  inviteId?: string;
  trialStartedAt?: Date;
  trialEndsAt?: Date | null;
  // 永久無料の特別アカウント向け(既定false)。trueの場合、将来実装される
  // trialEndsAt到達時の自動停止対象から明示的に除外する。
  billingExempt?: boolean;
}) {
  return prisma.subscription.create({ data: input });
}

export async function getLatestSubscriptionByClinicId(clinicId: string) {
  const subscription = await prisma.subscription.findFirst({
    where: { clinicId },
    orderBy: { createdAt: "desc" },
  });
  if (!subscription) return null;
  if (!isPlanId(subscription.plan) || !isSubscriptionStatus(subscription.status)) {
    throw new BillingRepositoryStateError("Stored subscription state is invalid.");
  }
  return {
    ...subscription,
    plan: subscription.plan,
    status: subscription.status,
  };
}

export async function transitionSubscriptionStatus(input: {
  clinicId: string;
  subscriptionId: string;
  to: SubscriptionStatus;
}) {
  const current = await prisma.subscription.findFirst({
    where: { id: input.subscriptionId, clinicId: input.clinicId },
  });
  if (!current || !isSubscriptionStatus(current.status)) {
    throw new BillingRepositoryStateError("Subscription was not found or is invalid.");
  }
  if (!canTransitionSubscription(current.status, input.to)) {
    throw new BillingRepositoryStateError("Subscription status transition is not allowed.");
  }
  return prisma.subscription.update({
    where: { id: current.id },
    data: { status: input.to },
  });
}

export async function recordPaymentEvent(input: {
  subscriptionId: string;
  status: string;
  externalPaymentId: string;
  occurredAt: Date;
}) {
  return prisma.payment.create({ data: input });
}

export async function updateSubscriptionPaymentMethodStatus(input: {
  subscriptionId: string;
  paymentMethodStatus: string;
}) {
  return prisma.subscription.update({
    where: { id: input.subscriptionId },
    data: { paymentMethodStatus: input.paymentMethodStatus },
  });
}

/**
 * 契約状態変化イベント(subscription_activated/subscription_canceled/trial_activated)の
 * payloadに含めるContact ID・同意日時を1件だけ選んで返す(2026-09-29追加、PO承認、
 * Salesforce連携P0-2)。医院に複数Contactが存在する場合、role="owner"を優先し、
 * 無ければ最も古いContactを使う(Salesforce側でLeadと紐付ける代表者を1名に絞るため)。
 * 外部通信は行わない(DB読み取りのみ)。tx・prismaのどちらからも呼べる。
 */
export async function findPrimaryContactPayloadFields(
  db: Prisma.TransactionClient,
  clinicId: string
): Promise<{ contactId: string | null; consentAcceptedAt: string | null }> {
  const owner = await db.contact.findFirst({
    where: { clinicId, role: "owner" },
    orderBy: { createdAt: "asc" },
    select: { id: true, consentAcceptedAt: true },
  });
  const contact =
    owner ??
    (await db.contact.findFirst({
      where: { clinicId },
      orderBy: { createdAt: "asc" },
      select: { id: true, consentAcceptedAt: true },
    }));
  return {
    contactId: contact?.id ?? null,
    consentAcceptedAt: contact?.consentAcceptedAt ? contact.consentAcceptedAt.toISOString() : null,
  };
}

async function findOrCreateWebhookSubscription(
  tx: Prisma.TransactionClient,
  identity: BillingWebhookIdentity,
  initialStatus: SubscriptionStatus | null,
  eventAt: Date,
  planMismatch: "throw" | "update" | "ignore" = "throw"
) {
  // Webhook側のclinicId申告値は、DB上に実在するとは限らない(テスト医院の削除後に、Stripe側だけ
  // 契約が残って後日イベントが届く等)。実在しない医院に契約を再作成すると外部キー違反で500になり、
  // Stripeが再送を繰り返すため、契約の新規作成前に医院の実在を確認し、無ければnull(=ignored)を返す。
  if (identity.clinicId && initialStatus) {
    const clinic = await tx.clinic.findUnique({
      where: { id: identity.clinicId },
      select: { id: true },
    });
    if (!clinic) return null;
  }

  // initialStatus===null(invoiceイベント)は既存の契約を参照するだけで、契約を新規作成しない。
  const subscription =
    identity.clinicId && identity.plan && initialStatus
      ? await tx.subscription.upsert({
          where: { externalSubscriptionId: identity.externalSubscriptionId },
          create: {
            clinicId: identity.clinicId,
            plan: identity.plan,
            status: initialStatus,
            externalSubscriptionId: identity.externalSubscriptionId,
            statusEventAt: eventAt,
            // 招待経由(1円モニター)のみ設定される。通常契約はnullのまま。
            inviteId: identity.inviteId ?? undefined,
          },
          update: {},
        })
      : await tx.subscription.findUnique({
          where: { externalSubscriptionId: identity.externalSubscriptionId },
        });

  if (!subscription) return null;
  if (identity.clinicId && subscription.clinicId !== identity.clinicId) {
    throw new BillingRepositoryStateError("Webhook clinic binding does not match.");
  }
  if (identity.plan && subscription.plan !== identity.plan) {
    // アップグレードAPIがStripe側のmetadata.planを更新したときの署名検証済みsubscriptionイベントだけ、
    // DBのplanを追随させる(それ以外のイベントは従来どおり不一致をエラーにする)。
    if (planMismatch === "update") {
      return tx.subscription.update({ where: { id: subscription.id }, data: { plan: identity.plan } });
    }
    // 請求書はプラン変更の前後どちらのmetadataでも届き得るため、planの不一致では失敗させない。
    if (planMismatch === "ignore") return subscription;
    throw new BillingRepositoryStateError("Webhook plan binding does not match.");
  }
  return subscription;
}

async function updateWebhookSubscriptionStatus(
  tx: Prisma.TransactionClient,
  subscription: Awaited<ReturnType<typeof findOrCreateWebhookSubscription>>,
  to: SubscriptionStatus,
  eventAt: Date
) {
  if (!subscription) return null;
  if (!isSubscriptionStatus(subscription.status)) {
    throw new BillingRepositoryStateError("Stored subscription state is invalid.");
  }
  if (subscription.statusEventAt && eventAt < subscription.statusEventAt) {
    return subscription;
  }
  if (!canTransitionSubscription(subscription.status, to)) {
    return subscription;
  }
  return tx.subscription.update({
    where: { id: subscription.id },
    data: { status: to, statusEventAt: eventAt },
  });
}

/**
 * 署名検証済みのStripe通知を1トランザクションで適用する。
 * providerEventIdの一意制約により再送を二重処理せず、生の通知本文は保存しない。
 */
export async function applyBillingWebhookEvent(
  input: BillingWebhookCommand
): Promise<BillingWebhookApplyOutcome> {
  return retryOnConcurrentWrite(() => applyBillingWebhookEventOnce(input));
}

// Stripeはsubscription.created / checkout.session.completedをほぼ同時に送るため、両者が同時に
// Subscriptionをupsertして一意制約違反(P2002)や書き込み競合(P2034)になり得る。トランザクションの
// 待ち・タイムアウト(P2028)も一時的な失敗として同様に再試行する(処理はproviderEventIdで冪等)。
// 敗者側は再実行すれば先行トランザクションの結果を読めるので、数回だけ再試行する。
export async function retryOnConcurrentWrite<T>(run: () => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      if ((code !== "P2002" && code !== "P2034" && code !== "P2028") || attempt >= attempts) throw error;
      // 競合が実際に起きた頻度と種類を運用ログで確認できるよう、再試行のたびに記録する。
      console.warn(`[billing webhook] concurrent write conflict (${String(code)}), retry ${attempt}/${attempts - 1}`);
      await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
    }
  }
}

async function applyBillingWebhookEventOnce(
  input: BillingWebhookCommand
): Promise<BillingWebhookApplyOutcome> {
  return prisma.$transaction(async (tx) => {
    const alreadyProcessed = await tx.billingWebhookEvent.findUnique({
      where: { providerEventId: input.providerEventId },
      select: { id: true },
    });
    if (alreadyProcessed) {
      return {
        result: "duplicate",
        notify: null,
        trialActivated: null,
        subscriptionActivated: null,
        subscriptionActivatedIntegrationEventId: null,
        subscriptionCanceled: null,
        subscriptionCanceledIntegrationEventId: null,
      };
    }

    let result: Exclude<BillingWebhookApplyResult, "duplicate"> = "processed";
    let clinicId: string | null = null;
    let notify: BillingStatusNotification | null = null;
    let trialActivated: TrialActivatedSignal | null = null;
    let subscriptionActivated: SubscriptionActivatedSignal | null = null;
    let subscriptionActivatedIntegrationEventId: string | null = null;
    let subscriptionCanceled: SubscriptionCanceledSignal | null = null;
    let subscriptionCanceledIntegrationEventId: string | null = null;

    if (input.action.kind === "ignored") {
      result = "ignored";
    } else {
      const initialStatus: SubscriptionStatus | null =
        input.action.kind === "checkout_completed"
          ? input.action.initialStatus
          : input.action.kind === "subscription_status"
            ? input.action.status
            : null;
      // 2026-09-27追加(PO承認、第1段階の計測強化): trialActivated判定専用に、
      // Subscriptionの「本当の更新前ステータス」を先に読んでおく(既存のnotify判定に
      // 使うstatusBeforeUpdateには手を加えない)。理由: 初回Webhookでは
      // findOrCreateWebhookSubscription()がupsertでtrial状態のまま新規作成するため、
      // その後のstatusBeforeUpdate(=作成直後の値)と比較しても遷移として検知できない
      // (行がまだ無かった=既定でnullとして扱う)。
      const priorSubscriptionForTrial = await tx.subscription.findUnique({
        where: { externalSubscriptionId: input.action.identity.externalSubscriptionId },
        select: { status: true },
      });
      const statusBeforeTrialCheck: SubscriptionStatus | null = priorSubscriptionForTrial
        ? isSubscriptionStatus(priorSubscriptionForTrial.status)
          ? priorSubscriptionForTrial.status
          : null
        : null;

      let subscription = await findOrCreateWebhookSubscription(
        tx,
        input.action.identity,
        initialStatus,
        input.occurredAt,
        input.action.kind === "invoice_status"
          ? "ignore"
          : input.eventType === "customer.subscription.updated"
            ? "update"
            : "throw"
      );
      if (!subscription) {
        // invoiceイベントが契約作成より先に届いた場合は、医院が実在する限り取りこぼさず再送させる。
        // 医院が実在しない(orphan)場合は従来どおりignored(再送させない)。
        if (input.action.kind === "invoice_status" && input.action.identity.clinicId) {
          const clinic = await tx.clinic.findUnique({
            where: { id: input.action.identity.clinicId },
            select: { id: true },
          });
          if (clinic) {
            return {
              result: "retry",
              notify: null,
              trialActivated: null,
              subscriptionActivated: null,
              subscriptionActivatedIntegrationEventId: null,
              subscriptionCanceled: null,
              subscriptionCanceledIntegrationEventId: null,
            };
          }
        }
        result = "ignored";
      } else {
        clinicId = subscription.clinicId;
        const statusBeforeUpdate = subscription.status;
        if (initialStatus) {
          subscription = await updateWebhookSubscriptionStatus(
            tx,
            subscription,
            initialStatus,
            input.occurredAt
          );
        }
        // トライアル期間はStripe Subscriptionのtrial_start/trial_endを正本として同期する。
        if (
          input.action.kind === "subscription_status" &&
          subscription &&
          input.action.trialStartedAt &&
          input.action.trialEndsAt
        ) {
          subscription = await tx.subscription.update({
            where: { id: subscription.id },
            data: {
              trialStartedAt: input.action.trialStartedAt,
              trialEndsAt: input.action.trialEndsAt,
            },
          });
        }
        if (
          subscription &&
          subscription.status !== statusBeforeUpdate &&
          isSubscriptionStatus(subscription.status) &&
          NOTIFY_ON_STATUSES.includes(subscription.status)
        ) {
          notify = { clinicId: subscription.clinicId, toStatus: subscription.status };
        }
        // 2026-09-27追加(PO承認、第1段階の計測強化): Stripeからのcustomer.subscription.*
        // Webhookで、statusが実際に(trial以外、または未作成)→trialへ遷移した瞬間だけを
        // 検知する。ブラウザの自己申告ではなくStripeの確定情報が根拠。
        // statusBeforeTrialCheck(このWebhook処理が始まる前の実際の状態、行が無ければnull)
        // と比較するため、同一Webhookイベントの再送(このtx到達前にproviderEventIdの
        // 一意制約で"duplicate"として弾かれる)や、既にtrial状態のSubscriptionへの
        // 他イベント適用では発火しない。
        if (
          subscription &&
          subscription.status === "trial" &&
          statusBeforeTrialCheck !== "trial" &&
          subscription.externalSubscriptionId
        ) {
          trialActivated = {
            clinicId: subscription.clinicId,
            externalSubscriptionId: subscription.externalSubscriptionId,
          };
        }
        // 2026-09-28追加(PO承認、P1-4「有料契約への移行」): statusが実際に
        // (active以外、または未作成)→activeへ遷移した瞬間を検知する。trial経由の
        // active化(trial_activatedとは別イベント)・トライアルなしの初回active化
        // (Premium即時課金等)の両方を対象とする。判定根拠はstatusBeforeTrialCheckと
        // 同じ(このWebhook処理が始まる前の実際の状態)。
        if (
          subscription &&
          subscription.status === "active" &&
          statusBeforeTrialCheck !== "active" &&
          subscription.externalSubscriptionId &&
          isPlanId(subscription.plan)
        ) {
          subscriptionActivated = {
            clinicId: subscription.clinicId,
            externalSubscriptionId: subscription.externalSubscriptionId,
            plan: subscription.plan,
            fromStatus: statusBeforeTrialCheck,
            viaTrial: subscription.trialStartedAt !== null,
          };
          // 【重要】「同一トランザクション内でイベントの存在を保証する」というPO指示を
          // 満たすため、tx.integrationEvent.create()+catch(P2002)は使わない
          // (PostgreSQLでは、トランザクション内でユニーク制約違反をJS側でcatchしても
          // トランザクション自体がaborted状態になり、以降のCOMMITが失敗しうる。
          // trialEntitlementRepository.tsのconsumeTrialEntitlementFromWebhook()で
          // 実PostgreSQL接続により検証済みの同じ対策を用いる)。
          // `INSERT ... ON CONFLICT ("dedupeKey") DO NOTHING`は例外を発生させず、
          // dedupeKeyが既に存在する場合は単に0行挿入して正常終了する
          // (=Subscription状態更新を含むこのトランザクション全体が問題なくCOMMITできる)。
          const dedupeKey = `subscription_activated:${subscriptionActivated.externalSubscriptionId}`;
          const newIntegrationEventId = crypto.randomUUID();
          // 2026-09-29追加(PO承認、Salesforce連携P0-2): 契約状態変化の同期にContact ID・
          // 同意日時を追加する(DB読み取りのみ、外部通信はしない)。
          const contactFields = await findPrimaryContactPayloadFields(tx, subscriptionActivated.clinicId);
          const payloadJson = JSON.stringify({
            plan: subscriptionActivated.plan,
            from_status: subscriptionActivated.fromStatus ?? "none",
            to_status: "active",
            via_trial: subscriptionActivated.viaTrial,
            contact_id: contactFields.contactId,
            consent_accepted_at: contactFields.consentAcceptedAt,
          });
          const insertedRows = await tx.$queryRaw<{ id: string }[]>`
            INSERT INTO "IntegrationEvent" ("id", "eventType", "payloadJson", "status", "clinicId", "contactId", "dedupeKey")
            VALUES (${newIntegrationEventId}, ${"subscription_activated"}, ${payloadJson}, ${"pending"}, ${subscriptionActivated.clinicId}, ${contactFields.contactId}, ${dedupeKey})
            ON CONFLICT ("dedupeKey") DO NOTHING
            RETURNING "id"
          `;
          subscriptionActivatedIntegrationEventId = insertedRows[0]?.id ?? null;
        }
        // 2026-09-29追加(PO承認、Salesforce連携P0-2): statusが実際に(cancelled以外)→
        // cancelledへ遷移した瞬間を検知する。"cancelled"は終端状態(遷移先を持たない)のため、
        // 判定根拠はstatusBeforeTrialCheck(このWebhook処理が始まる前の実際の状態)で十分
        // (subscriptionActivatedと同じ設計。同一Subscriptionにつき生涯1件だけ記録される)。
        if (
          subscription &&
          subscription.status === "cancelled" &&
          statusBeforeTrialCheck !== "cancelled" &&
          statusBeforeTrialCheck !== null &&
          subscription.externalSubscriptionId &&
          isPlanId(subscription.plan)
        ) {
          subscriptionCanceled = {
            clinicId: subscription.clinicId,
            externalSubscriptionId: subscription.externalSubscriptionId,
            plan: subscription.plan,
            fromStatus: statusBeforeTrialCheck,
          };
          const cancelDedupeKey = `subscription_canceled:${subscriptionCanceled.externalSubscriptionId}`;
          const newCancelIntegrationEventId = crypto.randomUUID();
          const cancelContactFields = await findPrimaryContactPayloadFields(tx, subscriptionCanceled.clinicId);
          const cancelPayloadJson = JSON.stringify({
            plan: subscriptionCanceled.plan,
            from_status: subscriptionCanceled.fromStatus,
            to_status: "cancelled",
            contact_id: cancelContactFields.contactId,
            consent_accepted_at: cancelContactFields.consentAcceptedAt,
          });
          const insertedCancelRows = await tx.$queryRaw<{ id: string }[]>`
            INSERT INTO "IntegrationEvent" ("id", "eventType", "payloadJson", "status", "clinicId", "contactId", "dedupeKey")
            VALUES (${newCancelIntegrationEventId}, ${"subscription_canceled"}, ${cancelPayloadJson}, ${"pending"}, ${subscriptionCanceled.clinicId}, ${cancelContactFields.contactId}, ${cancelDedupeKey})
            ON CONFLICT ("dedupeKey") DO NOTHING
            RETURNING "id"
          `;
          subscriptionCanceledIntegrationEventId = insertedCancelRows[0]?.id ?? null;
        }
        if (input.action.kind === "invoice_status" && subscription) {
          await tx.payment.upsert({
            where: { externalPaymentId: input.action.externalPaymentId },
            create: {
              subscriptionId: subscription.id,
              status: input.action.paymentStatus,
              externalPaymentId: input.action.externalPaymentId,
              occurredAt: input.occurredAt,
            },
            update: {
              status: input.action.paymentStatus,
              occurredAt: input.occurredAt,
            },
          });
          // Step8(アンバサダー、仮仕様): 有料契約+初回入金確定時点でのみ紹介成果を確定する。
          if (input.action.paymentStatus === "paid") {
            await confirmAttributionForClinic(tx, subscription.clinicId);
          }
        }
        // checkout完了(=決済方法登録完了)は、trialStartedAt自体を即設定せず
        // paymentMethodStatusのみ更新する。trial開始はactivateTrial.tsが
        // SMS・メール・規約同意すべての完了を確認したうえで別途行う(指示書4章)。
        if (input.action.kind === "checkout_completed" && subscription) {
          await tx.subscription.update({
            where: { id: subscription.id },
            data: { paymentMethodStatus: "completed" },
          });
        }
      }
    }

    await tx.billingWebhookEvent.create({
      data: {
        providerEventId: input.providerEventId,
        eventType: input.eventType,
        status: result,
        clinicId,
        occurredAt: input.occurredAt,
      },
    });
    return {
      result,
      notify,
      trialActivated,
      subscriptionActivated,
      subscriptionActivatedIntegrationEventId,
      subscriptionCanceled,
      subscriptionCanceledIntegrationEventId,
    };
  }, WEBHOOK_TRANSACTION_OPTIONS);
}
