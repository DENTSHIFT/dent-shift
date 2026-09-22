import { NextRequest, NextResponse } from "next/server";
import { isPlanId } from "@/domain/billing/planCatalog";
import { getCurrentContact } from "@/server/auth/session";
import {
  BillingConfigError,
  resolveBillingConfigFromProcessEnv,
} from "@/server/config/billingConfig";
import { createStripeCheckoutSession } from "@/server/providers/billing/stripeCheckoutProvider";
import { isTrialEligiblePlan, TRIAL_PERIOD_DAYS } from "@/domain/billing/trialActivation";

export async function POST(request: NextRequest) {
  const currentContact = await getCurrentContact();
  if (!currentContact) {
    return NextResponse.redirect(new URL("/login", request.url), 303);
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
    console.error(
      "[POST /api/billing/checkout] checkout creation failed:",
      error instanceof Error ? error.name : "UnknownError"
    );
    return NextResponse.json(
      { error: "決済画面を開始できませんでした。時間をおいて再度お試しください。" },
      { status: 502 }
    );
  }
}
