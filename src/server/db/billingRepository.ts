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

export async function setSubscriptionTrialPeriod(input: {
  subscriptionId: string;
  trialStartedAt: Date;
  trialEndsAt: Date;
}) {
  return prisma.subscription.update({
    where: { id: input.subscriptionId },
    data: { trialStartedAt: input.trialStartedAt, trialEndsAt: input.trialEndsAt },
  });
}

async function findOrCreateWebhookSubscription(
  tx: Prisma.TransactionClient,
  identity: BillingWebhookIdentity,
  initialStatus: SubscriptionStatus,
  eventAt: Date
) {
  const subscription =
    identity.clinicId && identity.plan
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
  return prisma.$transaction(async (tx) => {
    const alreadyProcessed = await tx.billingWebhookEvent.findUnique({
      where: { providerEventId: input.providerEventId },
      select: { id: true },
    });
    if (alreadyProcessed) return { result: "duplicate", notify: null };

    let result: Exclude<BillingWebhookApplyResult, "duplicate"> = "processed";
    let clinicId: string | null = null;
    let notify: BillingStatusNotification | null = null;

    if (input.action.kind === "ignored") {
      result = "ignored";
    } else {
      const initialStatus =
        input.action.kind === "checkout_completed"
          ? input.action.initialStatus
          : input.action.status;
      let subscription = await findOrCreateWebhookSubscription(
        tx,
        input.action.identity,
        initialStatus,
        input.occurredAt
      );
      if (!subscription) {
        result = "ignored";
      } else {
        clinicId = subscription.clinicId;
        const statusBeforeUpdate = subscription.status;
        subscription = await updateWebhookSubscriptionStatus(
          tx,
          subscription,
          initialStatus,
          input.occurredAt
        );
        if (
          subscription &&
          subscription.status !== statusBeforeUpdate &&
          isSubscriptionStatus(subscription.status) &&
          NOTIFY_ON_STATUSES.includes(subscription.status)
        ) {
          notify = { clinicId: subscription.clinicId, toStatus: subscription.status };
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
    return { result, notify };
  });
}
