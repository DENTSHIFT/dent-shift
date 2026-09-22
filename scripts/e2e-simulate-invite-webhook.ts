/**
 * 手動E2E専用の一時スクリプト。実行後は使い捨て(コミット不要)。
 * 招待経由のサブスクリプションcheckout.session.completed Webhookをローカルで
 * 再現する(理由はscripts/e2e-simulate-subscription-webhook.tsと同じ:
 * ローカルdevサーバーにWebhookが届かないため)。billing/webhook/route.tsの
 * checkout_completed分岐と同じ手順(applyBillingWebhookEvent→
 * activateTrialIfEligible→consumeInviteForClinic→
 * scheduleStripeSubscriptionCancellation)をこのスクリプトでも再現する。
 *
 * 使い方: DATABASE_URL=... STRIPE_SECRET_KEY=... npx tsx --conditions=react-server \
 *   scripts/e2e-simulate-invite-webhook.ts <checkoutSessionId>
 */
import { PrismaClient } from "@prisma/client";
import { applyBillingWebhookEvent, createSubscriptionRecord } from "../src/server/db/billingRepository";
import { isPlanId } from "../src/domain/billing/planCatalog";
import { consumeInviteForClinic, getInviteById } from "../src/server/db/inviteRepository";
import { computeInviteCancelAtEpochSeconds } from "../src/domain/invite/inviteCode";
import { scheduleStripeSubscriptionCancellation } from "../src/server/providers/billing/stripeCheckoutProvider";

async function main() {
  const sessionId = process.argv[2];
  if (!sessionId) {
    console.error("usage: tsx scripts/e2e-simulate-invite-webhook.ts <checkoutSessionId>");
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
    amount_total: number;
    metadata: Record<string, string>;
  };
  console.log("session:", session.id, "subscription:", session.subscription, "amount_total:", session.amount_total);

  const plan = session.metadata.plan ?? "";
  if (!isPlanId(plan)) throw new Error(`invalid plan: ${plan}`);

  const prisma = new PrismaClient();
  const existing = await prisma.subscription.findFirst({
    where: { externalSubscriptionId: session.subscription },
  });
  if (!existing) {
    await createSubscriptionRecord({
      clinicId: session.client_reference_id,
      plan,
      status: session.amount_total > 0 ? "active" : "trial",
      externalSubscriptionId: session.subscription,
    });
    console.log("subscription record created");
  }

  const result = await applyBillingWebhookEvent({
    providerEventId: `evt_manual_e2e_invite_${Date.now()}`,
    eventType: "checkout.session.completed",
    occurredAt: new Date(),
    action: {
      kind: "checkout_completed",
      identity: {
        externalSubscriptionId: session.subscription,
        clinicId: session.client_reference_id,
        plan,
        inviteId: session.metadata.invite_id ?? null,
        inviteCode: session.metadata.invite_code ?? null,
      },
      initialStatus: session.amount_total > 0 ? "active" : "trial",
    },
  });
  console.log("applyBillingWebhookEvent result:", result);

  const inviteId = session.metadata.invite_id;
  const clinicId = session.client_reference_id;
  if (inviteId) {
    const consumed = await consumeInviteForClinic({ inviteId, clinicId });
    console.log("consumeInviteForClinic:", consumed);

    const invite = await getInviteById(inviteId);
    if (invite) {
      const cancelAtEpochSeconds = computeInviteCancelAtEpochSeconds(new Date(), invite.durationMonths);
      await scheduleStripeSubscriptionCancellation({
        apiKey,
        subscriptionId: session.subscription,
        cancelAtEpochSeconds,
      });
      console.log("scheduleStripeSubscriptionCancellation: done, cancelAt =", new Date(cancelAtEpochSeconds * 1000).toISOString());
    }
  }

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
