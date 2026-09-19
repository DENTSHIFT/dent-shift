import { NextRequest, NextResponse } from "next/server";
import { getCurrentContact } from "@/server/auth/session";
import {
  BillingConfigError,
  resolveBillingConfigFromProcessEnv,
} from "@/server/config/billingConfig";
import { getLatestSubscriptionByClinicId } from "@/server/db/billingRepository";
import { createStripeCustomerPortalSession } from "@/server/providers/billing/stripeCustomerPortalProvider";

export async function POST(request: NextRequest) {
  const currentContact = await getCurrentContact();
  if (!currentContact) {
    return NextResponse.redirect(new URL("/login", request.url), 303);
  }

  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403 });
  }

  let config;
  try {
    config = resolveBillingConfigFromProcessEnv();
  } catch (error) {
    if (error instanceof BillingConfigError) {
      console.error("[POST /api/billing/portal] billing configuration error");
      return NextResponse.json(
        { error: "契約・請求管理は現在準備中です。" },
        { status: 503 }
      );
    }
    throw error;
  }
  if (config.provider === "disabled") {
    return NextResponse.json(
      { error: "契約・請求管理は現在準備中です。" },
      { status: 503 }
    );
  }

  const subscription = await getLatestSubscriptionByClinicId(currentContact.clinicId);
  if (!subscription?.externalSubscriptionId) {
    return NextResponse.json({ error: "管理できる契約がありません。" }, { status: 404 });
  }

  try {
    const portal = await createStripeCustomerPortalSession({
      apiKey: config.apiKey,
      externalSubscriptionId: subscription.externalSubscriptionId,
      appBaseUrl: config.appBaseUrl,
    });
    return NextResponse.redirect(portal.url, 303);
  } catch (error) {
    console.error(
      "[POST /api/billing/portal] portal creation failed:",
      error instanceof Error ? error.name : "UnknownError"
    );
    return NextResponse.json(
      { error: "契約・請求管理画面を開始できませんでした。時間をおいて再度お試しください。" },
      { status: 502 }
    );
  }
}
