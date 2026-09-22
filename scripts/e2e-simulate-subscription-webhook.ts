/**
 * 手動E2E専用の一時スクリプト。実行後は使い捨て(コミット不要)。
 * サブスクリプション版のcheckout.session.completed Webhookを、実際のStripe
 * Checkout Sessionデータを使って直接applyBillingWebhookEvent()へ適用する
 * (ローカルdevサーバーにはWebhookが届かないための代替検証。理由は
 * scripts/e2e-simulate-checkout-webhook.tsと同じ)。
 *
 * 使い方: DATABASE_URL=... STRIPE_SECRET_KEY=... npx tsx --conditions=react-server \
 *   scripts/e2e-simulate-subscription-webhook.ts <checkoutSessionId>
 */
import { PrismaClient } from "@prisma/client";
import { applyBillingWebhookEvent, createSubscriptionRecord } from "../src/server/db/billingRepository";
import { isPlanId } from "../src/domain/billing/planCatalog";

async function main() {
  const sessionId = process.argv[2];
  if (!sessionId) {
    console.error("usage: tsx scripts/e2e-simulate-subscription-webhook.ts <checkoutSessionId>");
    process.exit(1);
  }
  const apiKey = process.env.STRIPE_SECRET_KEY;
  if (!apiKey) throw new Error("STRIPE_SECRET_KEY not set");

  const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`Stripe API error: ${res.status} ${await res.text()}`);
  const session = (await res.json()) as {
    id: string;
    client_reference_id: string;
    subscription: string;
    payment_status: string;
    metadata: Record<string, string>;
  };
  console.log("session:", session.id, "subscription:", session.subscription, "plan:", session.metadata.plan);

  const plan = session.metadata.plan ?? "";
  if (!isPlanId(plan)) throw new Error(`invalid plan: ${plan}`);

  const prisma = new PrismaClient();
  // createSubscriptionRecord相当(実際はapplyBillingWebhookEvent内のsubscription_status
  // イベントが行うが、こちらはcheckout_completedイベント単体では新規作成しないため、
  // 本番同様まずcheckout_completedを適用し、無ければ作成する形を踏襲する)。
  const existing = await prisma.subscription.findFirst({
    where: { externalSubscriptionId: session.subscription },
  });
  if (!existing) {
    await createSubscriptionRecord({
      clinicId: session.client_reference_id,
      plan,
      status: session.payment_status === "paid" ? "active" : "trial",
      externalSubscriptionId: session.subscription,
    });
    console.log("subscription record created");
  }

  const result = await applyBillingWebhookEvent({
    providerEventId: `evt_manual_e2e_checkout_${Date.now()}`,
    eventType: "checkout.session.completed",
    occurredAt: new Date(),
    action: {
      kind: "checkout_completed",
      identity: {
        externalSubscriptionId: session.subscription,
        clinicId: session.client_reference_id,
        plan,
      },
      initialStatus: session.payment_status === "paid" ? "active" : "trial",
    },
  });
  console.log("applyBillingWebhookEvent(checkout_completed) result:", result);

  // Stripeのsubscriptionオブジェクト自体からtrial_end等を取得し、customer.subscription.created
  // 相当の状態同期も行う(trial_end有無でstatusが変わるため)。
  const subRes = await fetch(`https://api.stripe.com/v1/subscriptions/${session.subscription}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const sub = (await subRes.json()) as { status: string; trial_end: number | null; current_period_end: number };
  console.log("stripe subscription status:", sub.status, "trial_end:", sub.trial_end);

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
