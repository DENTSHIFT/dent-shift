import { NextRequest, NextResponse } from "next/server";
import { isPlanId } from "@/domain/billing/planCatalog";
import { getCurrentContact } from "@/server/auth/session";
import {
  BillingConfigError,
  resolveBillingConfigFromProcessEnv,
} from "@/server/config/billingConfig";
import { createStripeCheckoutSession } from "@/server/providers/billing/stripeCheckoutProvider";
import {
  evaluateCheckoutEligibility,
  isTrialEligiblePlan,
  TRIAL_PERIOD_DAYS,
} from "@/domain/billing/trialActivation";
import { getLatestSubscriptionByClinicId } from "@/server/db/billingRepository";
import { hasExistingSubscription } from "@/domain/billing/subscriptionStatus";

export async function POST(request: NextRequest) {
  const currentContact = await getCurrentContact();
  if (!currentContact) {
    return NextResponse.redirect(new URL("/login", request.url), 303);
  }

  // 2026-09-25: SMS認証・メール確認・規約同意が済むまでStripe Checkoutを作らせない
  // (Checkout作成時点で7日間無料トライアルが始まるため)。UI非表示に依存せずサーバーで必ず拒否し、
  // 未完了ステップの案内があるダッシュボードへ戻す。
  const eligibility = evaluateCheckoutEligibility({
    phoneVerifiedAt: currentContact.phoneVerifiedAt,
    smsVerificationExempt: currentContact.smsVerificationExempt,
    emailVerifiedAt: currentContact.emailVerifiedAt,
    consentAcceptedAt: currentContact.consentAcceptedAt,
  });
  if (!eligibility.ok) {
    return NextResponse.redirect(new URL("/dashboard", request.url), 303);
  }

  let config;
  try {
    config = resolveBillingConfigFromProcessEnv();
  } catch (error) {
    if (error instanceof BillingConfigError) {
      console.error("[POST /api/billing/checkout] billing configuration error");
      return NextResponse.json(
        { error: "オンライン契約は現在準備中です。" },
        { status: 503 }
      );
    }
    throw error;
  }
  if (config.provider === "disabled") {
    return NextResponse.json(
      { error: "オンライン契約は現在準備中です。" },
      { status: 503 }
    );
  }

  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "プランを選択してください。" }, { status: 400 });
  }
  const plan = formData.get("plan");
  if (typeof plan !== "string" || !isPlanId(plan)) {
    return NextResponse.json({ error: "プランを選択してください。" }, { status: 400 });
  }

  // 二重契約・二重課金防止(2026-09-23)。既存の有効な契約(billingExempt/Pilot含む)が
  // あるクリニックは新規Checkoutを作成させない。画面側の非表示だけに依存せず、
  // API側でも必ずガードする。
  const existingSubscription = await getLatestSubscriptionByClinicId(currentContact.clinicId);
  if (hasExistingSubscription(existingSubscription)) {
    return NextResponse.json(
      { error: "既にご契約中です。プランの変更・解約はダッシュボードから行えます。" },
      { status: 409 }
    );
  }

  try {
    const checkout = await createStripeCheckoutSession({
      apiKey: config.apiKey,
      priceId: config.stripePriceIds[plan],
      taxRateId: config.taxRateId,
      plan,
      clinicId: currentContact.clinicId,
      contactEmail: currentContact.email,
      appBaseUrl: config.appBaseUrl,
      trialPeriodDays: isTrialEligiblePlan(plan) ? TRIAL_PERIOD_DAYS : undefined,
    });
    return NextResponse.redirect(checkout.url, 303);
  } catch (error) {
    // 例外メッセージ本文もログへ出す(Stripe APIキー等の機密値は含まれない)。
    console.error(
      "[POST /api/billing/checkout] checkout creation failed:",
      error instanceof Error ? `${error.name}: ${error.message}` : "UnknownError"
    );
    return NextResponse.json(
      { error: "決済画面を開始できませんでした。時間をおいて再度お試しください。" },
      { status: 502 }
    );
  }
}
