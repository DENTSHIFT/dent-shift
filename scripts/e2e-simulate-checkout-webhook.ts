/**
 * 手動E2E専用の一時スクリプト。実行後は使い捨て(コミット不要)。
 * Stripeのtest環境Webhookエンドポイントは本番相当のtest.dentshift.jpへ向いているため、
 * ローカルdevサーバー(localhost:3000)には届かない(Stripe CLIトンネル無しでは既知の制約。
 * Webhookのエンドポイント疎通自体は別途200 OKで確認済み)。
 * ここでは実際のStripe Checkout Sessionを取得し、本番のnormalizeStripeOneTimePurchaseEvent
 * 相当のコマンドを組み立てて、applyOptionOrderWebhookEvent()を直接呼び出す。
 * Webhook HTTP層はスキップするが、ビジネスロジック(決済確定→生成キュー→PDF生成)は
 * 実コードパスで検証する。
 *
 * 使い方: DATABASE_URL=... npx tsx --conditions=react-server scripts/e2e-simulate-checkout-webhook.ts <orderId>
 */
import { PrismaClient } from "@prisma/client";
import { applyOptionOrderWebhookEvent } from "../src/server/db/optionOrderRepository";
import { generateInstructionPdfArtifact } from "../src/server/services/optionOrders/generateInstructionPdfArtifact";

async function main() {
  const orderId = process.argv[2];
  if (!orderId) {
    console.error("usage: tsx scripts/e2e-simulate-checkout-webhook.ts <orderId>");
    process.exit(1);
  }
  const prisma = new PrismaClient();
  const order = await prisma.optionOrder.findUniqueOrThrow({ where: { id: orderId } });
  if (!order.stripeCheckoutSessionId) throw new Error("order has no stripeCheckoutSessionId");

  const apiKey = process.env.STRIPE_SECRET_KEY;
  if (!apiKey) throw new Error("STRIPE_SECRET_KEY not set");

  const res = await fetch(
    `https://api.stripe.com/v1/checkout/sessions/${order.stripeCheckoutSessionId}`,
    { headers: { Authorization: `Bearer ${apiKey}` } }
  );
  if (!res.ok) throw new Error(`Stripe API error: ${res.status} ${await res.text()}`);
  const session = (await res.json()) as {
    id: string;
    payment_status: string;
    payment_intent: string;
    amount_total: number;
    metadata: Record<string, string>;
  };
  console.log("Stripe session payment_status:", session.payment_status);

  const result = await applyOptionOrderWebhookEvent({
    providerEventId: `evt_manual_e2e_${Date.now()}`,
    eventType: "checkout.session.completed",
    occurredAt: new Date(),
    action: {
      kind: "one_time_paid",
      identity: {
        stripeCheckoutSessionId: session.id,
        clinicId: session.metadata.clinic_id ?? null,
        reportId: session.metadata.report_id ?? null,
        version: Number(session.metadata.version),
        optionProductKey: session.metadata.option_product_key ?? null,
        improvementActionKey: session.metadata.improvement_action_id ?? null,
      },
      stripePaymentIntentId: session.payment_intent,
      amountTotalJpy: session.amount_total,
    },
  });
  console.log("applyOptionOrderWebhookEvent result:", result);

  await generateInstructionPdfArtifact(orderId);
  const updated = await prisma.optionOrder.findUniqueOrThrow({ where: { id: orderId } });
  console.log("order status after generation:", updated.status);

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
