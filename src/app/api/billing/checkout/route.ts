import { NextRequest, NextResponse } from "next/server";
import { isPlanId } from "@/domain/billing/planCatalog";
import { getCurrentContact } from "@/server/auth/session";
import {
  BillingConfigError,
  resolveBillingConfigFromProcessEnv,
} from "@/server/config/billingConfig";
import {
  createStripeCheckoutSession,
  retrieveStripeCheckoutSession,
} from "@/server/providers/billing/stripeCheckoutProvider";
import {
  evaluateCheckoutEligibility,
  isTrialEligiblePlan,
  TRIAL_PERIOD_DAYS,
} from "@/domain/billing/trialActivation";
import { getLatestSubscriptionByClinicId } from "@/server/db/billingRepository";
import { hasExistingSubscription } from "@/domain/billing/subscriptionStatus";
import { enqueueIntegrationEvent } from "@/server/db/integrationEventRepository";
import { isClinicTrialEligible } from "@/domain/billing/trialEntitlement";
import {
  attachStripeSessionToReservation,
  getClinicTrialState,
  releaseOwnReservation,
  reserveTrialEntitlement,
} from "@/server/db/trialEntitlementRepository";

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

  // 2026-09-27追加(PO承認、P0-Checkout接続): ライト/スタンダードで、かつこの医院が
  // まだ無料トライアルを消費していない場合のみ、TrialEntitlementの予約を試みる
  // (判定はclinicId単位、Contact/メールアドレス単位ではない)。プレミアム(トライアル
  // 対象外)や消費済みの医院は、この予約フローを一切通らず、従来どおり即時課金で
  // 契約できる(PO指示1: 「Premiumなどトライアル対象外プランの通常契約は、トライアル
  // 消費済みでも契約可能」)。
  let wantsTrial = false;
  if (isTrialEligiblePlan(plan)) {
    const clinic = await getClinicTrialState(currentContact.clinicId);
    wantsTrial = clinic !== null && isClinicTrialEligible(clinic);
  }

  if (!wantsTrial) {
    return startCheckoutWithoutTrial({ config, plan, currentContact });
  }

  const reservation = await reserveTrialEntitlement({ clinicId: currentContact.clinicId });

  if (reservation.outcome === "already_consumed") {
    // 予約直前に他の経路で消費済みへ変わっていた場合(トライアル対象外として)そのまま契約させる。
    return startCheckoutWithoutTrial({ config, plan, currentContact });
  }
  if (reservation.outcome === "reservation_in_progress") {
    // 別リクエストがまさにSession作成中。重複Sessionを作らず、再試行可能な409を返す。
    return NextResponse.json(
      { error: "手続きを準備しています。少し待って再度お試しください。" },
      { status: 409 }
    );
  }
  if (reservation.outcome === "existing_session") {
    // 同じ処理の安全な再試行とみなし、既存Stripe Sessionを再取得して再利用する。
    try {
      const existing = await retrieveStripeCheckoutSession({
        apiKey: config.apiKey,
        sessionId: reservation.checkoutSessionId,
      });
      if (existing && existing.status === "open" && existing.url) {
        return NextResponse.redirect(existing.url, 303);
      }
    } catch (error) {
      console.error(
        "[POST /api/billing/checkout] existing session retrieval failed:",
        error instanceof Error ? `${error.name}: ${error.message}` : "UnknownError"
      );
    }
    // Session側が既に期限切れ・完了済み等で再利用できない場合は、429相当として
    // 再試行を促す(この予約行自体は期限が来れば自然にreleasedへ遷移する)。
    return NextResponse.json(
      { error: "手続きを準備しています。少し待って再度お試しください。" },
      { status: 425 }
    );
  }

  // ここに来るのはreservation.outcome === "reserved"(=この予約の所有者)の場合のみ。
  const { entitlementId, ownerToken } = reservation;

  try {
    const checkout = await createStripeCheckoutSession({
      apiKey: config.apiKey,
      priceId: config.stripePriceIds[plan],
      taxRateId: config.taxRateId,
      plan,
      clinicId: currentContact.clinicId,
      contactEmail: currentContact.email,
      appBaseUrl: config.appBaseUrl,
      trialPeriodDays: TRIAL_PERIOD_DAYS,
      trialEntitlementId: entitlementId,
    });

    // Stripeが実際に発行したsession.id・expires_atを、所有者一致を条件に予約行へ保存する。
    // DBトランザクションを開いたままStripe APIを呼ばない(先にStripe呼び出しを完了させてから
    // この短い条件付き更新のみを行う)。
    const expiresAt = checkout.expiresAtEpochSeconds
      ? new Date(checkout.expiresAtEpochSeconds * 1000)
      : new Date(Date.now() + 30 * 60 * 1000);
    const attached = await attachStripeSessionToReservation({
      entitlementId,
      ownerToken,
      checkoutSessionId: checkout.id,
      expiresAt,
    });
    if (!attached) {
      // 所有権を失っていた(通常は起こり得ないが、念のための防御)。このSessionを
      // ユーザーへ返さず安全に停止する。
      console.error(
        "[POST /api/billing/checkout] lost reservation ownership after session creation"
      );
      return NextResponse.json(
        { error: "決済画面を開始できませんでした。時間をおいて再度お試しください。" },
        { status: 502 }
      );
    }

    // 2026-09-27追加(PO承認、第1段階): 「トライアル対象プランを選択した/Checkoutへ
    // 進んだ」の計測(既存のIntegrationEvent基盤のみを使用、新規の外部分析サービスは
    // 追加しない)。計測失敗はCheckout自体を妨げない(ベストエフォート)。
    await enqueueIntegrationEvent({
      eventType: "checkout_started",
      clinicId: currentContact.clinicId,
      contactId: currentContact.id,
      payload: { plan, trial_eligible: true },
    }).catch((error) => {
      console.error("[POST /api/billing/checkout] Salesforce sync enqueue failed:", error);
    });

    return NextResponse.redirect(checkout.url, 303);
  } catch (error) {
    // Stripe Session作成が失敗した場合、該当する自分の予約だけをreleasedへ遷移する
    // (別リクエストの予約は解放しない、ownerToken一致が条件、PO指示3)。
    await releaseOwnReservation({ entitlementId, ownerToken }).catch((releaseError) => {
      console.error(
        "[POST /api/billing/checkout] releaseOwnReservation after failure also failed:",
        releaseError
      );
    });
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

async function startCheckoutWithoutTrial(input: {
  config: import("@/server/config/billingConfig").StripeBillingConfig;
  plan: import("@/domain/billing/planCatalog").PlanId;
  currentContact: { clinicId: string; id: string; email: string };
}): Promise<NextResponse> {
  const { config, plan, currentContact } = input;
  try {
    const checkout = await createStripeCheckoutSession({
      apiKey: config.apiKey,
      priceId: config.stripePriceIds[plan],
      taxRateId: config.taxRateId,
      plan,
      clinicId: currentContact.clinicId,
      contactEmail: currentContact.email,
      appBaseUrl: config.appBaseUrl,
      trialPeriodDays: undefined,
    });

    await enqueueIntegrationEvent({
      eventType: "checkout_started",
      clinicId: currentContact.clinicId,
      contactId: currentContact.id,
      payload: { plan, trial_eligible: false },
    }).catch((error) => {
      console.error("[POST /api/billing/checkout] Salesforce sync enqueue failed:", error);
    });

    return NextResponse.redirect(checkout.url, 303);
  } catch (error) {
    console.error(
      "[POST /api/billing/checkout] checkout creation failed (no-trial path):",
      error instanceof Error ? `${error.name}: ${error.message}` : "UnknownError"
    );
    return NextResponse.json(
      { error: "決済画面を開始できませんでした。時間をおいて再度お試しください。" },
      { status: 502 }
    );
  }
}
