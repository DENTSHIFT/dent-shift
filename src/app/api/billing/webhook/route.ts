import { NextResponse } from "next/server";
import {
  BillingConfigError,
  resolveBillingConfigFromProcessEnv,
} from "@/server/config/billingConfig";
import { applyBillingWebhookEvent } from "@/server/db/billingRepository";
import {
  normalizeStripeBillingEvent,
  normalizeStripeOneTimePurchaseEvent,
  StripeWebhookVerificationError,
  verifyStripeWebhookEvent,
} from "@/server/providers/billing/stripeWebhookProvider";
import { applyOptionOrderWebhookEvent } from "@/server/db/optionOrderRepository";
import { prisma } from "@/server/db/prismaClient";
import { activateTrialIfEligible } from "@/server/services/activateTrial";
import { generateInstructionPdfArtifact } from "@/server/services/optionOrders/generateInstructionPdfArtifact";

export const runtime = "nodejs";

/**
 * checkout.session.completedがサブスク用(プラン契約)か単発商品購入
 * (制作会社向け修正指示書等)かを、object.subscriptionの有無で判定する。
 * 同じイベントを両方のapply*WebhookEvent()へ渡すと、billingWebhookEvent行の
 * 早い者勝ちの一意制約により後発側が誤ってduplicate扱いになるため、
 * どちらか一方だけに振り分ける(二重処理防止の要)。
 */
function isOneTimeCheckoutCompleted(event: { type: string; data: { object: unknown } }): boolean {
  if (event.type !== "checkout.session.completed") return false;
  const object = event.data.object as Record<string, unknown> | null;
  return !object?.subscription;
}

export async function POST(request: Request) {
  let config;
  try {
    config = resolveBillingConfigFromProcessEnv();
  } catch (error) {
    if (error instanceof BillingConfigError) {
      console.error("[POST /api/billing/webhook] billing configuration error");
      return NextResponse.json({ error: "決済通知は現在無効です。" }, { status: 503 });
    }
    throw error;
  }
  if (config.provider === "disabled") {
    return NextResponse.json({ error: "決済通知は現在無効です。" }, { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "署名がありません。" }, { status: 400 });
  }

  // JSONへ変換する前の本文がStripeの署名検証に必要。
  const payload = await request.text();
  let event;
  try {
    event = verifyStripeWebhookEvent({
      payload,
      signature,
      apiKey: config.apiKey,
      webhookSecret: config.webhookSecret,
    });
  } catch (error) {
    if (error instanceof StripeWebhookVerificationError) {
      return NextResponse.json({ error: "署名を確認できませんでした。" }, { status: 400 });
    }
    throw error;
  }

  try {
    if (isOneTimeCheckoutCompleted(event)) {
      const command = normalizeStripeOneTimePurchaseEvent(event);
      const result = await applyOptionOrderWebhookEvent(command);

      // 決済確認(generation_queuedへの遷移)の直後に生成まで進める。生成失敗は
      // ここで握りつぶし、決済自体は成功として200を返す(Stripe側の再送・二重課金を防ぐ)。
      // 失敗した生成はClinicAuditLog/GeneratedArtifact.lastErrorに記録済みで、
      // ダッシュボード側の再生成導線(Phase6)から再試行できる。
      if (result === "processed" && command.action.kind === "one_time_paid") {
        const order = await prisma.optionOrder.findUnique({
          where: { stripeCheckoutSessionId: command.action.identity.stripeCheckoutSessionId },
          select: { id: true },
        });
        if (order) {
          await generateInstructionPdfArtifact(order.id).catch((generationError) => {
            console.error(
              "[POST /api/billing/webhook] generateInstructionPdfArtifact failed:",
              generationError instanceof Error ? generationError.message : "UnknownError"
            );
          });
        }
      }

      return NextResponse.json({ received: true, result });
    }

    const command = normalizeStripeBillingEvent(event);
    const result = await applyBillingWebhookEvent(command);

    // 決済方法登録完了(checkout完了)を契機に、他の3条件(SMS/メール/規約同意)が
    // 既に揃っていればtrialを開始する(指示書4章、activateTrial.ts参照)。
    if (result === "processed" && command.action?.kind === "checkout_completed") {
      const clinicId = command.action.identity.clinicId;
      if (clinicId) {
        const contacts = await prisma.contact.findMany({ where: { clinicId } });
        for (const contact of contacts) {
          await activateTrialIfEligible(contact.id).catch((activationError) => {
            console.error(
              "[POST /api/billing/webhook] activateTrialIfEligible failed:",
              activationError
            );
          });
        }
      }
    }

    return NextResponse.json({ received: true, result });
  } catch (error) {
    console.error(
      "[POST /api/billing/webhook] processing failed:",
      error instanceof Error ? error.name : "UnknownError"
    );
    return NextResponse.json({ error: "決済通知を処理できませんでした。" }, { status: 500 });
  }
}
