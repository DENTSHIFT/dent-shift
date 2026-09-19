import "server-only";

export class StripeCustomerPortalProviderError extends Error {}

async function stripeRequest(url: string, options: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new StripeCustomerPortalProviderError("Stripe customer portal request failed.");
  }

  if (!response.ok) {
    // Stripeの応答本文には顧客情報や設定値が含まれうるため、ログ・例外へ含めない。
    throw new StripeCustomerPortalProviderError(
      `Stripe customer portal returned HTTP ${response.status}.`
    );
  }

  try {
    return await response.json();
  } catch {
    throw new StripeCustomerPortalProviderError(
      "Stripe customer portal returned invalid JSON."
    );
  }
}

export async function createStripeCustomerPortalSession(input: {
  apiKey: string;
  externalSubscriptionId: string;
  appBaseUrl: string;
}): Promise<{ url: string }> {
  const headers = { Authorization: `Bearer ${input.apiKey}` };
  const subscription = (await stripeRequest(
    `https://api.stripe.com/v1/subscriptions/${encodeURIComponent(input.externalSubscriptionId)}`,
    { method: "GET", headers }
  )) as { customer?: unknown };

  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : typeof subscription.customer === "object" && subscription.customer !== null
        ? (subscription.customer as { id?: unknown }).id
        : null;
  if (typeof customerId !== "string" || !customerId.startsWith("cus_")) {
    throw new StripeCustomerPortalProviderError(
      "Stripe subscription did not include a valid customer."
    );
  }

  const params = new URLSearchParams({
    customer: customerId,
    return_url: `${input.appBaseUrl}/dashboard#subscription`,
  });
  const portal = (await stripeRequest("https://api.stripe.com/v1/billing_portal/sessions", {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  })) as { url?: unknown };

  if (typeof portal.url !== "string") {
    throw new StripeCustomerPortalProviderError(
      "Stripe customer portal response did not include a URL."
    );
  }

  let portalUrl: URL;
  try {
    portalUrl = new URL(portal.url);
  } catch {
    throw new StripeCustomerPortalProviderError(
      "Stripe customer portal returned an invalid URL."
    );
  }
  if (portalUrl.protocol !== "https:" || portalUrl.hostname !== "billing.stripe.com") {
    throw new StripeCustomerPortalProviderError(
      "Stripe customer portal returned an untrusted URL."
    );
  }

  return { url: portalUrl.toString() };
}
