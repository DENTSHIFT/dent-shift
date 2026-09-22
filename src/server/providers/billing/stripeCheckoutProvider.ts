import "server-only";
import type { PlanId } from "@/domain/billing/planCatalog";

export class StripeCheckoutProviderError extends Error {}

async function postCheckoutSession(
  apiKey: string,
  params: URLSearchParams
): Promise<{ url: string; id: string }> {
  let response: Response;
  try {
    response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new StripeCheckoutProviderError("Stripe Checkout request failed.");
  }

  if (!response.ok) {
    // Stripeの応答本文には設定値や決済情報が含まれうるため、ログ・例外へ含めない。
    throw new StripeCheckoutProviderError(`Stripe Checkout returned HTTP ${response.status}.`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new StripeCheckoutProviderError("Stripe Checkout returned invalid JSON.");
  }
  const urlValue = (body as { url?: unknown }).url;
  const idValue = (body as { id?: unknown }).id;
  if (typeof urlValue !== "string") {
    throw new StripeCheckoutProviderError("Stripe Checkout response did not include a URL.");
  }
  if (typeof idValue !== "string" || !idValue) {
    throw new StripeCheckoutProviderError("Stripe Checkout response did not include a session id.");
  }

  let checkoutUrl: URL;
  try {
    checkoutUrl = new URL(urlValue);
  } catch {
    throw new StripeCheckoutProviderError("Stripe Checkout returned an invalid URL.");
  }
  if (
    checkoutUrl.protocol !== "https:" ||
    (checkoutUrl.hostname !== "stripe.com" && !checkoutUrl.hostname.endsWith(".stripe.com"))
  ) {
    throw new StripeCheckoutProviderError("Stripe Checkout returned an untrusted URL.");
  }

  return { url: checkoutUrl.toString(), id: idValue };
}

export async function createStripeCheckoutSession(input: {
  apiKey: string;
  priceId: string;
  taxRateId: string;
  plan: PlanId;
  clinicId: string;
  contactEmail: string;
  appBaseUrl: string;
  // ライト・スタンダードのみ7(Ver3.3仕様)。プレミアムはundefinedで即時課金。
  // 呼び出し側(billing/checkout/route.ts)がtrialActivation.tsのisTrialEligiblePlan()
  // で判定した値を渡す(対象プラン一覧をここで再定義しない)。
  trialPeriodDays?: number;
}): Promise<{ url: string; id: string }> {
  const params = new URLSearchParams();
  params.set("mode", "subscription");
  params.set("line_items[0][price]", input.priceId);
  params.set("line_items[0][quantity]", "1");
  params.set("line_items[0][tax_rates][0]", input.taxRateId);
  params.set("success_url", `${input.appBaseUrl}/onboarding?checkout=success`);
  params.set("cancel_url", `${input.appBaseUrl}/plans?checkout=cancelled`);
  params.set("client_reference_id", input.clinicId);
  params.set("customer_email", input.contactEmail);
  params.set("metadata[clinic_id]", input.clinicId);
  params.set("metadata[plan]", input.plan);
  params.set("subscription_data[metadata][clinic_id]", input.clinicId);
  params.set("subscription_data[metadata][plan]", input.plan);
  if (input.trialPeriodDays) {
    params.set("subscription_data[trial_period_days]", String(input.trialPeriodDays));
    // トライアル中でもカード登録を必須にする(仕様: 8日目に自動課金するため)。
    // これを付けない場合、Stripeはtrial付きCheckoutで支払い方法の入力を省略できてしまう。
    params.set("payment_method_collection", "always");
  }

  return postCheckoutSession(input.apiKey, params);
}

/**
 * 知人院長向け「1円モニター利用」専用Checkout Session(2026-09-22確定)。
 * 通常のcreateStripeCheckoutSession()とは意図的に別関数にしている:
 * - priceIdは通常プランのSTRIPE_PRICE_ID_*とは完全に別のInvite専用Price
 * - trial_period_daysは使わない(招待自体が特別価格のため、初回から¥1課金)
 * - tax_ratesは付与しない(招待価格は税込¥1として運用する前提。課税事業者判定等は
 *   本番運用時に別途確認)
 *
 * 「durationMonths後に自動終了」は、Checkout Session作成時の
 * subscription_data[cancel_at]では実現できない(Stripe API上そのパラメータは
 * 存在せず、実際にAPIへ送ると invalid_request_error になることを確認済み)。
 * 代わりに、決済確定(checkout.session.completed Webhook)後にSubscription
 * オブジェクト自体をscheduleStripeSubscriptionCancellation()で更新する。
 */
export async function createStripeInviteCheckoutSession(input: {
  apiKey: string;
  priceId: string;
  clinicId: string;
  contactEmail: string;
  appBaseUrl: string;
  successPath: string;
  cancelPath: string;
  metadata: {
    clinicId: string;
    plan: string;
    inviteCode: string;
    inviteId: string;
  };
}): Promise<{ url: string; id: string }> {
  const params = new URLSearchParams();
  params.set("mode", "subscription");
  params.set("line_items[0][price]", input.priceId);
  params.set("line_items[0][quantity]", "1");
  params.set("success_url", `${input.appBaseUrl}${input.successPath}`);
  params.set("cancel_url", `${input.appBaseUrl}${input.cancelPath}`);
  params.set("client_reference_id", input.clinicId);
  params.set("customer_email", input.contactEmail);
  params.set("metadata[clinic_id]", input.metadata.clinicId);
  params.set("metadata[plan]", input.metadata.plan);
  params.set("metadata[invite_code]", input.metadata.inviteCode);
  params.set("metadata[invite_id]", input.metadata.inviteId);
  params.set("subscription_data[metadata][clinic_id]", input.metadata.clinicId);
  params.set("subscription_data[metadata][plan]", input.metadata.plan);
  params.set("subscription_data[metadata][invite_code]", input.metadata.inviteCode);
  params.set("subscription_data[metadata][invite_id]", input.metadata.inviteId);

  return postCheckoutSession(input.apiKey, params);
}

/**
 * 招待経由のSubscriptionへ「絶対時刻での自動終了」を設定する。cancel_atは
 * Subscriptionリソース自体のフィールドであり、Checkout Session作成時には
 * 設定できないため、決済確定後(Webhook)にこのAPIで別途更新する。
 */
export async function scheduleStripeSubscriptionCancellation(input: {
  apiKey: string;
  subscriptionId: string;
  cancelAtEpochSeconds: number;
}): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`https://api.stripe.com/v1/subscriptions/${input.subscriptionId}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ cancel_at: String(input.cancelAtEpochSeconds) }).toString(),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new StripeCheckoutProviderError("Stripe subscription update request failed.");
  }
  if (!response.ok) {
    throw new StripeCheckoutProviderError(
      `Stripe subscription update returned HTTP ${response.status}.`
    );
  }
}

/**
 * 単発(one-time)商品のCheckout Session。制作会社向け修正指示書(仕様書Ver1)等、
 * サブスクリプションと異なりmode="payment"で作成する。Webhook側は
 * stripeWebhookProvider.tsのnormalizeStripeOneTimePurchaseEvent()がこのSessionを
 * object.subscriptionなしのcheckout.session.completedとして識別する。
 */
export async function createStripeOneTimeCheckoutSession(input: {
  apiKey: string;
  priceId: string;
  clinicId: string;
  contactEmail: string;
  appBaseUrl: string;
  successPath: string;
  cancelPath: string;
  // Checkout metadataに必ず含める(仕様書■5)。他の値は呼び出し側が拡張しない
  // ホワイトリスト方式にするため、ここで受け取るキーを固定する。
  metadata: {
    clinicId: string;
    improvementActionId?: string;
    reportId: string;
    version: string;
    optionProductKey: string;
  };
}): Promise<{ url: string; id: string }> {
  const params = new URLSearchParams();
  params.set("mode", "payment");
  params.set("line_items[0][price]", input.priceId);
  params.set("line_items[0][quantity]", "1");
  params.set("success_url", `${input.appBaseUrl}${input.successPath}`);
  params.set("cancel_url", `${input.appBaseUrl}${input.cancelPath}`);
  params.set("client_reference_id", input.clinicId);
  params.set("customer_email", input.contactEmail);
  params.set("metadata[clinic_id]", input.metadata.clinicId);
  if (input.metadata.improvementActionId) {
    params.set("metadata[improvement_action_id]", input.metadata.improvementActionId);
  }
  params.set("metadata[report_id]", input.metadata.reportId);
  params.set("metadata[version]", input.metadata.version);
  params.set("metadata[option_product_key]", input.metadata.optionProductKey);

  return postCheckoutSession(input.apiKey, params);
}
