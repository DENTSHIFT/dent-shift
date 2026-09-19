import "server-only";
import type { PlanId } from "@/domain/billing/planCatalog";

export class StripeCheckoutProviderError extends Error {}

export async function createStripeCheckoutSession(input: {
  apiKey: string;
  priceId: string;
  taxRateId: string;
  plan: PlanId;
  clinicId: string;
  contactEmail: string;
  appBaseUrl: string;
}): Promise<{ url: string }> {
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

  let response: Response;
  try {
    response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
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
  if (typeof urlValue !== "string") {
    throw new StripeCheckoutProviderError("Stripe Checkout response did not include a URL.");
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

  return { url: checkoutUrl.toString() };
}
