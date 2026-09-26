import "server-only";
import type { PlanId } from "@/domain/billing/planCatalog";

export class StripeUpgradeError extends Error {}

async function stripeJson(url: string, init: RequestInit): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new StripeUpgradeError("Stripe upgrade request failed.");
  }
  if (!response.ok) throw new StripeUpgradeError(`Stripe upgrade returned HTTP ${response.status}.`);
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    throw new StripeUpgradeError("Stripe upgrade returned invalid JSON.");
  }
}

/**
 * 既存Subscriptionの唯一のitemを新プランのPriceへ差し替える。trial_endは送らないため
 * トライアル期間は維持される。Price IDは呼び出し側がプランからサーバー側で決めた値のみ渡す。
 */
export async function upgradeStripeSubscriptionPlan(input: {
  apiKey: string;
  externalSubscriptionId: string;
  priceId: string;
  taxRateId: string;
  targetPlan: PlanId;
  proration: "none" | "always_invoice";
}): Promise<void> {
  const headers = { Authorization: `Bearer ${input.apiKey}` };
  const subUrl = `https://api.stripe.com/v1/subscriptions/${encodeURIComponent(input.externalSubscriptionId)}`;
  const current = await stripeJson(subUrl, { method: "GET", headers });
  const items = (current.items as { data?: Array<{ id?: unknown }> } | undefined)?.data;
  if (!Array.isArray(items) || items.length !== 1 || typeof items[0]?.id !== "string") {
    throw new StripeUpgradeError("Unexpected subscription items.");
  }

  const params = new URLSearchParams();
  params.set("items[0][id]", items[0].id);
  params.set("items[0][price]", input.priceId);
  params.set("items[0][quantity]", "1");
  params.set("items[0][tax_rates][0]", input.taxRateId);
  params.set("metadata[plan]", input.targetPlan);
  params.set("proration_behavior", input.proration);
  if (input.proration === "always_invoice") params.set("payment_behavior", "error_if_incomplete");

  await stripeJson(subUrl, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
}
