import "server-only";
import { resolveBillingConfigFromProcessEnv, BillingConfigError } from "@/server/config/billingConfig";
import {
  resolveOptionProductStripeRefsFromProcessEnv,
  requireOptionProductStripeRef,
} from "@/server/config/optionProductConfig";
import { OPTION_PRODUCTS } from "@/domain/options/optionProductCatalog";
import type { PlanId } from "@/domain/billing/planCatalog";
import {
  INSTRUCTION_PDF_ENTITLEMENT_KEY,
  INSTRUCTION_PDF_MONTHLY_QUOTA,
  currentEntitlementPeriod,
} from "@/domain/options/planEntitlements";
import {
  createOrReuseDraftOptionOrder,
  ensureOptionProduct,
  markOptionOrderCheckoutCreated,
} from "@/server/db/optionOrderRepository";
import { tryConsumeEntitlement } from "@/server/db/planEntitlementUsageRepository";
import { createStripeOneTimeCheckoutSession } from "@/server/providers/billing/stripeCheckoutProvider";
import { recordClinicAuditLog } from "@/server/db/clinicAuditLogRepository";
import { prisma } from "@/server/db/prismaClient";
import { generateInstructionPdfArtifact } from "./generateInstructionPdfArtifact";

export class InstructionPdfOrderError extends Error {}

/**
 * 「現在の制作会社へ依頼する」導線の注文作成。
 *
 * planId(呼び出し側=APIルートが判定した「無料枠を消費できる契約状態にある場合の
 * 現在プラン」。無ければnull)を受け取り、無料枠の判定・消費はこのサービス内で
 * PlanEntitlementUsageへの原子的な消費(tryConsumeEntitlement)として1トランザクション
 * で行う(同時リクエストでも二重消費されない。仕様書Ver1■)。
 *
 * 同一reportId×version×productKeyの注文は使い回す(二重課金防止)。既にdraft以降
 * (included/checkout_created等)へ進んだ注文がある場合は無料枠を再消費せず、
 * 既存注文をそのまま返す(呼び出し側が状態に応じて案内できるようにする)。
 */
export async function requestInstructionPdfOrder(input: {
  clinicId: string;
  contactId: string;
  contactEmail: string;
  reportId: string;
  version?: number;
  improvementActionKey?: string;
  planId: PlanId | null;
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

  const includedQuantity = input.planId ? INSTRUCTION_PDF_MONTHLY_QUOTA[input.planId] : 0;
  if (includedQuantity > 0) {
    const period = currentEntitlementPeriod();
    const included = await prisma.$transaction(async (tx) => {
      const consumed = await tryConsumeEntitlement(tx, {
        clinicId: input.clinicId,
        entitlementKey: INSTRUCTION_PDF_ENTITLEMENT_KEY,
        period,
        includedQuantity,
      });
      if (!consumed) return false;
      await tx.optionOrder.update({
        where: { id: order.id },
        data: { status: "included", includedByPlan: true, amountJpy: 0 },
      });
      // 決済(Webhook)を経由しないため、ここで生成待ちまで進めておく
      // (paid→generation_queuedと同じ扱い。Webhookのapply処理と対称にする)。
      await tx.optionOrder.update({
        where: { id: order.id },
        data: { status: "generation_queued" },
      });
      await recordClinicAuditLog(tx, {
        clinicId: input.clinicId,
        contactId: input.contactId,
        action: "option_order_included",
        targetType: "OptionOrder",
        targetId: order.id,
        metadata: { productKey, reportId: input.reportId, version, period },
      });
      return true;
    });
    if (included) {
      await generateInstructionPdfArtifact(order.id).catch((generationError) => {
        console.error(
          "[requestInstructionPdfOrder] generateInstructionPdfArtifact failed:",
          generationError instanceof Error ? generationError.message : "UnknownError"
        );
      });
      return { checkoutUrl: null, orderId: order.id, status: "included" };
    }
    // 無料枠を使い切っている場合は都度課金(Checkout作成)へフォールスルーする。
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
