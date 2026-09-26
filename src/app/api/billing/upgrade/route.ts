import { NextRequest, NextResponse } from "next/server";
import { getCurrentContact } from "@/server/auth/session";
import { BillingConfigError, resolveBillingConfigFromProcessEnv } from "@/server/config/billingConfig";
import { getLatestSubscriptionByClinicId } from "@/server/db/billingRepository";
import { isPlanId } from "@/domain/billing/planCatalog";
import { evaluateUpgrade } from "@/domain/billing/planUpgrade";
import { upgradeStripeSubscriptionPlan } from "@/server/providers/billing/stripeSubscriptionUpgradeProvider";

// アップグレード専用API。クライアントから受け取るのはtargetPlanのみで、Stripe Price IDは
// サーバー側でプランから決める。ダウングレード・同一プランはここでは受け付けない。
export async function POST(request: NextRequest) {
  const contact = await getCurrentContact();
  if (!contact) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });

  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "リクエストが不正です。" }, { status: 400 });
  }
  const targetPlan = (body as { targetPlan?: unknown } | null)?.targetPlan;
  if (typeof targetPlan !== "string" || !isPlanId(targetPlan)) {
    return NextResponse.json({ error: "プランの指定が不正です。" }, { status: 400 });
  }

  let config;
  try {
    config = resolveBillingConfigFromProcessEnv();
  } catch (error) {
    if (error instanceof BillingConfigError) {
      console.error("[POST /api/billing/upgrade] billing configuration error");
      return NextResponse.json({ error: "プラン変更は現在準備中です。" }, { status: 503 });
    }
    throw error;
  }
  if (config.provider === "disabled") {
    return NextResponse.json({ error: "プラン変更は現在準備中です。" }, { status: 503 });
  }

  const subscription = await getLatestSubscriptionByClinicId(contact.clinicId);
  if (!subscription?.externalSubscriptionId) {
    return NextResponse.json({ error: "変更できる契約がありません。" }, { status: 404 });
  }

  const decision = evaluateUpgrade({
    currentPlan: subscription.plan,
    status: subscription.status,
    billingExempt: subscription.billingExempt,
    invited: subscription.inviteId !== null,
    targetPlan,
  });
  if (!decision.ok) {
    const status = decision.reason === "not_an_upgrade" ? 400 : 409;
    return NextResponse.json({ error: "この契約ではこのプランへ変更できません。" }, { status });
  }

  try {
    await upgradeStripeSubscriptionPlan({
      apiKey: config.apiKey,
      externalSubscriptionId: subscription.externalSubscriptionId,
      priceId: config.stripePriceIds[targetPlan],
      taxRateId: config.taxRateId,
      targetPlan,
      proration: decision.proration,
    });
  } catch (error) {
    console.error(
      "[POST /api/billing/upgrade] upgrade failed:",
      error instanceof Error ? error.name : "UnknownError"
    );
    return NextResponse.json(
      { error: "プランを変更できませんでした。お支払い情報をご確認のうえ、再度お試しください。" },
      { status: 502 }
    );
  }
  // DBのplanはStripeのcustomer.subscription.updated Webhookで反映する。
  return NextResponse.json({ ok: true, targetPlan }, { status: 200 });
}
