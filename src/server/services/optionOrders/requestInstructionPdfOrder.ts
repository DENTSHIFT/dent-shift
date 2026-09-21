import "server-only";
import { resolveBillingConfigFromProcessEnv, BillingConfigError } from "@/server/config/billingConfig";
import {
  resolveOptionProductStripeRefsFromProcessEnv,
  requireOptionProductStripeRef,
} from "@/server/config/optionProductConfig";
import { OPTION_PRODUCTS } from "@/domain/options/optionProductCatalog";
import {
  createOrReuseDraftOptionOrder,
  ensureOptionProduct,
  markOptionOrderCheckoutCreated,
} from "@/server/db/optionOrderRepository";
import { createStripeOneTimeCheckoutSession } from "@/server/providers/billing/stripeCheckoutProvider";
import { recordClinicAuditLog } from "@/server/db/clinicAuditLogRepository";
import { prisma } from "@/server/db/prismaClient";

export class InstructionPdfOrderError extends Error {}

/**
 * 「現在の制作会社へ依頼する」導線の注文作成。
 *
 * includedByPlanは呼び出し側(APIルート)が無料枠判定(Phase3のPlanEntitlementUsage)の
 * 結果を渡す。このサービス自体は無料枠ロジックを持たず、Stripe Checkout作成と
 * 注文の冪等な作成・状態遷移にのみ責務を持つ。
 *
 * 同一reportId×version×productKeyの注文は使い回す(二重課金防止)。既にpaid以降の
 * 注文がある場合はCheckoutを新規作成せず、既存注文をそのまま返す(呼び出し側が
 * 「決済済み・生成待ち」として案内できるようにする)。
 */
export async function requestInstructionPdfOrder(input: {
  clinicId: string;
  contactId: string;
  contactEmail: string;
  reportId: string;
  version?: number;
  improvementActionKey?: string;
  includedByPlan: boolean;
  planSnapshot?: string | null;
}): Promise<{ checkoutUrl: string | null; orderId: string; status: string }> {
  const productKey = "instruction_pdf";
  const definition = OPTION_PRODUCTS[productKey];
  const version = input.version ?? 1;

  const stripeRefs = resolveOptionProductStripeRefsFromProcessEnv();
  const stripeRef = requireOptionProductStripeRef(productKey, stripeRefs);

  const product = await ensureOptionProduct({
    definition,
    stripePriceId: stripeRef.stripePriceId,
  });

  const order = await createOrReuseDraftOptionOrder({
    clinicId: input.clinicId,
    contactId: input.contactId,
    productId: product.id,
    productKey,
    reportId: input.reportId,
    version,
    improvementActionKey: input.improvementActionKey,
    planSnapshot: input.planSnapshot,
  });

  // 既に決済・生成が進んでいる注文は、Checkoutを再作成せずそのまま返す
  // (二重課金防止。ダウンロード可否は呼び出し側がorder.statusで判定する)。
  if (order.status !== "draft") {
    return { checkoutUrl: null, orderId: order.id, status: order.status };
  }

  if (input.includedByPlan) {
    await prisma.optionOrder.update({
      where: { id: order.id },
      data: { status: "included", includedByPlan: true, amountJpy: 0 },
    });
    await recordClinicAuditLog(prisma, {
      clinicId: input.clinicId,
      contactId: input.contactId,
      action: "option_order_included",
      targetType: "OptionOrder",
      targetId: order.id,
      metadata: { productKey, reportId: input.reportId, version },
    });
    return { checkoutUrl: null, orderId: order.id, status: "included" };
  }

  let billingConfig;
  try {
    billingConfig = resolveBillingConfigFromProcessEnv();
  } catch (error) {
    if (error instanceof BillingConfigError) {
      throw new InstructionPdfOrderError("Billing configuration is invalid.");
    }
    throw error;
  }
  if (billingConfig.provider !== "stripe") {
    throw new InstructionPdfOrderError("Stripe billing is not enabled.");
  }

  const { url, id: stripeCheckoutSessionId } = await createStripeOneTimeCheckoutSession({
    apiKey: billingConfig.apiKey,
    priceId: stripeRef.stripePriceId,
    clinicId: input.clinicId,
    contactEmail: input.contactEmail,
    appBaseUrl: billingConfig.appBaseUrl,
    successPath: `/dashboard/options/instruction-pdf?orderId=${encodeURIComponent(order.id)}&checkout=success`,
    cancelPath: `/dashboard/options/instruction-pdf?orderId=${encodeURIComponent(order.id)}&checkout=cancelled`,
    metadata: {
      clinicId: input.clinicId,
      improvementActionId: input.improvementActionKey,
      reportId: input.reportId,
      version: String(version),
      optionProductKey: productKey,
    },
  });

  await markOptionOrderCheckoutCreated({
    orderId: order.id,
    stripeCheckoutSessionId,
    amountJpy: definition.priceJpy,
    priceSnapshot: definition.priceJpy,
  });

  await recordClinicAuditLog(prisma, {
    clinicId: input.clinicId,
    contactId: input.contactId,
    action: "option_order_checkout_created",
    targetType: "OptionOrder",
    targetId: order.id,
    metadata: { productKey, reportId: input.reportId, version },
  });

  return { checkoutUrl: url, orderId: order.id, status: "checkout_created" };
}
