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

  return postCheckoutSession(input.apiKey, params);
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
