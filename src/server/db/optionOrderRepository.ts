import "server-only";
import { prisma } from "./prismaClient";
import type { Prisma } from "@prisma/client";
import {
  canTransitionOptionOrderStatus,
  isOptionOrderStatus,
  type OptionOrderStatus,
} from "@/domain/options/optionOrderStatus";
import type {
  OptionOrderWebhookApplyResult,
  OptionOrderWebhookCommand,
} from "@/domain/options/optionOrderWebhook";
import type { OptionProductDefinition } from "@/domain/options/optionProductCatalog";
import { recordClinicAuditLog } from "./clinicAuditLogRepository";

export class OptionOrderRepositoryStateError extends Error {}

/**
 * 商品マスター(OptionProduct)をkeyで冪等にupsertする。Stripe Price IDが未設定の
 * 商品は呼び出し側でresolveOptionProductStripeRefsにより弾かれるため、ここでは
 * 常にstripePriceIdを受け取った状態で呼ばれる想定。
 */
export async function ensureOptionProduct(input: {
  definition: OptionProductDefinition;
  stripeProductId?: string | null;
  stripePriceId: string;
}) {
  return prisma.optionProduct.upsert({
    where: { key: input.definition.key },
    create: {
      key: input.definition.key,
      name: input.definition.name,
      description: input.definition.description,
      deliveryType: input.definition.deliveryType,
      priceJpy: input.definition.priceJpy,
      stripeProductId: input.stripeProductId ?? null,
      stripePriceId: input.stripePriceId,
    },
    update: {
      name: input.definition.name,
      description: input.definition.description,
      priceJpy: input.definition.priceJpy,
      stripePriceId: input.stripePriceId,
      ...(input.stripeProductId ? { stripeProductId: input.stripeProductId } : {}),
    },
  });
}

export async function getOptionProductByKey(key: string) {
  return prisma.optionProduct.findUnique({ where: { key } });
}

/**
 * reportId×version×productKeyで冪等に注文行を用意する。既に同じ組の注文が
 * あれば(生成失敗からの再試行・二重クリック等)新規作成せずその行を返す
 * (仕様書■「二重生成・二重課金の防止」)。
 */
export async function createOrReuseDraftOptionOrder(input: {
  clinicId: string;
  contactId: string | null;
  productId: string;
  productKey: string;
  reportId: string;
  version: number;
  improvementActionKey?: string | null;
  planSnapshot?: string | null;
}) {
  const existing = await prisma.optionOrder.findUnique({
    where: {
      reportId_version_productKey: {
        reportId: input.reportId,
        version: input.version,
        productKey: input.productKey,
      },
    },
  });
  if (existing) {
    if (existing.clinicId !== input.clinicId) {
      throw new OptionOrderRepositoryStateError("Option order clinic binding does not match.");
    }
    return existing;
  }
  return prisma.optionOrder.create({
    data: {
      clinicId: input.clinicId,
      contactId: input.contactId,
      productId: input.productId,
      productKey: input.productKey,
      reportId: input.reportId,
      version: input.version,
      improvementActionKey: input.improvementActionKey ?? null,
      planSnapshot: input.planSnapshot ?? null,
      status: "draft",
    },
  });
}

/**
 * 注文にStripe Checkout Session IDを紐付け、checkout_createdへ遷移する。
 * stripeCheckoutSessionIdはunique制約を持つため、同一注文の再Checkout(前回が
 * 期限切れ・失敗した場合)でも別注文が増えることはない。
 */
export async function markOptionOrderCheckoutCreated(input: {
  orderId: string;
  stripeCheckoutSessionId: string;
  amountJpy: number;
  priceSnapshot: number;
}) {
  const order = await prisma.optionOrder.findUnique({ where: { id: input.orderId } });
  if (!order || !isOptionOrderStatus(order.status)) {
    throw new OptionOrderRepositoryStateError("Option order was not found or is invalid.");
  }
  if (!canTransitionOptionOrderStatus(order.status as OptionOrderStatus, "checkout_created")) {
    throw new OptionOrderRepositoryStateError("Option order status transition is not allowed.");
  }
  return prisma.optionOrder.update({
    where: { id: order.id },
    data: {
      status: "checkout_created",
      stripeCheckoutSessionId: input.stripeCheckoutSessionId,
      amountJpy: input.amountJpy,
      priceSnapshot: input.priceSnapshot,
    },
  });
}

export async function getOptionOrderById(orderId: string) {
  return prisma.optionOrder.findUnique({ where: { id: orderId } });
}

/**
 * ダウンロード成功のたびに呼ぶ。available→downloadedへ遷移し、以降の再ダウンロードは
 * downloaded→downloaded(自己遷移、状態機械上許可済み)で冪等に扱う。
 * 「dl可能かどうか」の判定(DOWNLOADABLE_STATUSES)はavailable/downloaded/completedを
 * 引き続きすべて許可しているため、この遷移自体は再ダウンロード可否に影響しない
 * (2026-09-22のユーザー指示: 監査ログはdownloadedまで記録されるのにOptionOrder.status
 * がavailableのまま止まっていた状態管理の不整合を解消する)。
 */
export async function markOptionOrderDownloaded(orderId: string) {
  const order = await prisma.optionOrder.findUnique({ where: { id: orderId } });
  if (!order || !isOptionOrderStatus(order.status)) {
    throw new OptionOrderRepositoryStateError("Option order was not found or is invalid.");
  }
  if (!canTransitionOptionOrderStatus(order.status as OptionOrderStatus, "downloaded")) {
    // completed等、ダウンロード後さらに進んだ状態からの再ダウンロードは状態を戻さない。
    return order;
  }
  return prisma.optionOrder.update({
    where: { id: order.id },
    data: { status: "downloaded" },
  });
}

export async function getOptionOrderByReport(input: {
  reportId: string;
  version: number;
  productKey: string;
}) {
  return prisma.optionOrder.findUnique({
    where: {
      reportId_version_productKey: {
        reportId: input.reportId,
        version: input.version,
        productKey: input.productKey,
      },
    },
  });
}

async function updateOptionOrderStatus(
  tx: Prisma.TransactionClient,
  order: { id: string; status: string },
  to: OptionOrderStatus
) {
  if (!isOptionOrderStatus(order.status)) {
    throw new OptionOrderRepositoryStateError("Stored option order status is invalid.");
  }
  if (!canTransitionOptionOrderStatus(order.status, to)) {
    // 既に同じ状態以降まで進んでいる場合は再送とみなし、何もしない(冪等)。
    return null;
  }
  return tx.optionOrder.update({ where: { id: order.id }, data: { status: to } });
}

/**
 * 署名検証済みのStripe通知を1トランザクションで適用する。billingRepository.tsの
 * applyBillingWebhookEvent()と同じ、BillingWebhookEvent.providerEventIdの一意制約
 * による冪等性パターンを踏襲する(Stripe イベントIDはドメインをまたいで一意)。
 */
export async function applyOptionOrderWebhookEvent(
  input: OptionOrderWebhookCommand
): Promise<OptionOrderWebhookApplyResult> {
  return prisma.$transaction(async (tx) => {
    const alreadyProcessed = await tx.billingWebhookEvent.findUnique({
      where: { providerEventId: input.providerEventId },
      select: { id: true },
    });
    if (alreadyProcessed) return "duplicate";

    if (input.action.kind === "ignored") {
      await tx.billingWebhookEvent.create({
        data: {
          providerEventId: input.providerEventId,
          eventType: input.eventType,
          status: "ignored",
          occurredAt: input.occurredAt,
        },
      });
      return "ignored";
    }

    const { identity, stripePaymentIntentId } = input.action;
    const order = await tx.optionOrder.findUnique({
      where: { stripeCheckoutSessionId: identity.stripeCheckoutSessionId },
    });
    if (!order) {
      // identity.clinicIdはWebhook側の申告値でありDB上の実在確認前のため、
      // 外部キー制約違反を避けるためclinicIdは記録しない(存在しないCheckout Session
      // 自体が異常系であり、通常運用では発生しない)。
      await tx.billingWebhookEvent.create({
        data: {
          providerEventId: input.providerEventId,
          eventType: input.eventType,
          status: "order_not_found",
          occurredAt: input.occurredAt,
        },
      });
      return "order_not_found";
    }
    if (identity.clinicId && order.clinicId !== identity.clinicId) {
      throw new OptionOrderRepositoryStateError("Webhook clinic binding does not match order.");
    }

    // 既にpaid以降まで進んでいる場合は二重webhook配信とみなし、状態変更・監査ログ追加を
    // 行わずduplicate扱いにする(二重課金・二重生成の防止)。
    const alreadyPaid = !canTransitionOptionOrderStatus(
      order.status as OptionOrderStatus,
      "paid"
    );
    if (alreadyPaid) {
      await tx.billingWebhookEvent.create({
        data: {
          providerEventId: input.providerEventId,
          eventType: input.eventType,
          status: "duplicate",
          clinicId: order.clinicId,
          occurredAt: input.occurredAt,
        },
      });
      return "duplicate";
    }

    await tx.optionOrder.update({
      where: { id: order.id },
      data: {
        status: "paid",
        paidAt: input.occurredAt,
        stripePaymentIntentId: stripePaymentIntentId ?? undefined,
      },
    });
    // 決済確認後は即座に生成キューへ進める(実際の生成job起動はPhase4のスコープ)。
    await updateOptionOrderStatus(tx, { id: order.id, status: "paid" }, "generation_queued");

    await tx.billingWebhookEvent.create({
      data: {
        providerEventId: input.providerEventId,
        eventType: input.eventType,
        status: "processed",
        clinicId: order.clinicId,
        occurredAt: input.occurredAt,
      },
    });

    await recordClinicAuditLog(tx, {
      clinicId: order.clinicId,
      contactId: order.contactId,
      action: "option_order_paid",
      targetType: "OptionOrder",
      targetId: order.id,
      metadata: { stripeCheckoutSessionId: identity.stripeCheckoutSessionId },
    });

    return "processed";
  });
}
