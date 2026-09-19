import "server-only";
import type { PlanId } from "@/domain/billing/planCatalog";
import { PLAN_PRICE_LABELS } from "@/domain/billing/planPricing";

export class BillingConfigError extends Error {}

export interface DisabledBillingConfig {
  provider: "disabled";
  priceLabels: Readonly<Record<PlanId, string>>;
}

export interface StripeBillingConfig {
  provider: "stripe";
  apiKey: string;
  webhookSecret: string;
  taxRateId: string;
  appBaseUrl: string;
  priceLabels: Record<PlanId, string>;
  stripePriceIds: Record<PlanId, string>;
}

export type BillingConfig = DisabledBillingConfig | StripeBillingConfig;

const STRIPE_PRICE_ID_KEYS: Record<PlanId, string> = {
  light: "STRIPE_PRICE_ID_LIGHT",
  standard: "STRIPE_PRICE_ID_STANDARD",
  premium: "STRIPE_PRICE_ID_PREMIUM",
};

function optionalPlanValues(
  env: Record<string, string | undefined>,
  keys: Record<PlanId, string>
): Record<PlanId, string | null> {
  return {
    light: env[keys.light]?.trim() || null,
    standard: env[keys.standard]?.trim() || null,
    premium: env[keys.premium]?.trim() || null,
  };
}

function requireAbsoluteHttpUrl(value: string | undefined, key: string): string {
  if (!value?.trim()) throw new BillingConfigError(`${key} is required for Stripe billing.`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BillingConfigError(`${key} must be a valid absolute URL.`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new BillingConfigError(`${key} must use http or https.`);
  }
  return url.origin;
}

export function resolveBillingConfig(options: {
  env: Record<string, string | undefined>;
}): BillingConfig {
  const { env } = options;
  const provider = env.BILLING_PROVIDER?.trim() || "disabled";
  if (provider === "disabled") return { provider, priceLabels: PLAN_PRICE_LABELS };
  if (provider !== "stripe") {
    throw new BillingConfigError("BILLING_PROVIDER must be exactly 'disabled' or 'stripe'.");
  }

  const apiKey = env.STRIPE_SECRET_KEY?.trim();
  if (!apiKey) throw new BillingConfigError("STRIPE_SECRET_KEY is required for Stripe billing.");
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) {
    throw new BillingConfigError("STRIPE_WEBHOOK_SECRET is required for Stripe billing.");
  }
  const taxRateId = env.STRIPE_TAX_RATE_ID?.trim();
  if (!taxRateId) {
    throw new BillingConfigError("STRIPE_TAX_RATE_ID is required for Stripe billing.");
  }
  const stripePriceIds = optionalPlanValues(env, STRIPE_PRICE_ID_KEYS);
  for (const plan of ["light", "standard", "premium"] as const) {
    if (!stripePriceIds[plan]) {
      throw new BillingConfigError(`${STRIPE_PRICE_ID_KEYS[plan]} is required for Stripe billing.`);
    }
  }

  return {
    provider,
    apiKey,
    webhookSecret,
    taxRateId,
    appBaseUrl: requireAbsoluteHttpUrl(env.APP_BASE_URL, "APP_BASE_URL"),
    priceLabels: PLAN_PRICE_LABELS,
    stripePriceIds: stripePriceIds as Record<PlanId, string>,
  };
}

export function resolveBillingConfigFromProcessEnv(): BillingConfig {
  return resolveBillingConfig({ env: process.env });
}
