import "server-only";
import type { PlanId } from "@/domain/billing/planCatalog";
import { PLAN_PRICE_LABELS } from "@/domain/billing/planPricing";

export class BillingConfigError extends Error {}

export interface DisabledBillingConfig {
  provider: "disabled";
  priceLabels: Readonly<Record<PlanId, string>>;
}

// 2026-09-28追加(PO再指摘、Stripe test/live取り違え防止): サーバー専用の期待モード。
// この値と実際のSTRIPE_SECRET_KEYのprefixが一致しない場合、Stripeへ書き込みを行う
// 全経路(Checkout作成・招待Checkout・単発Checkout・Subscription更新等)を
// fail-closedで停止する(resolveBillingConfig自体がBillingConfigErrorを投げる)。
export type StripeExpectedMode = "test" | "live";

export interface StripeBillingConfig {
  provider: "stripe";
  apiKey: string;
  webhookSecret: string;
  taxRateId: string;
  appBaseUrl: string;
  priceLabels: Record<PlanId, string>;
  stripePriceIds: Record<PlanId, string>;
  // 秘密鍵のprefixから判定した実際のmode(秘密鍵の値そのものではない)。
  // Checkout Session作成後、Stripeが返すlivemodeフィールドとの追加照合に使う
  // (createStripeCheckoutSession等の呼び出し側参照)。
  expectedMode: StripeExpectedMode;
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

// Stripeの秘密鍵/制限付きキーのprefixから実際のmodeを判定する(値そのものやfingerprintは
// 一切ログへ出さない、判定結果のtest/live/nullのみを扱う)。sk_/rk_のどちらのprefixにも対応する
// (制限付きキー(restricted key)はrk_で始まる)。
function detectStripeKeyMode(apiKey: string): StripeExpectedMode | null {
  if (/^(sk|rk)_test_/.test(apiKey)) return "test";
  if (/^(sk|rk)_live_/.test(apiKey)) return "live";
  return null;
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

  // 2026-09-28追加(PO再指摘): Stripeのtest/live取り違えを恒久的に防ぐfail-closedガード。
  // STRIPE_EXPECTED_MODEは必須(未設定・不明な値はエラー)。秘密鍵のprefixから判定した
  // 実際のmodeと一致しない場合もエラーにする。キー本体・prefixの残り・fingerprintは
  // 一切ログへ出さず、「不一致という事実」だけを記録する。この関数はCheckout・Webhook・
  // 招待/単発Checkout・Subscription更新等、Stripeへ書き込みを行う全経路が共通で呼ぶ
  // resolveBillingConfig()自体に組み込むため、個別実装のしわ寄せが起きない。
  const expectedModeRaw = env.STRIPE_EXPECTED_MODE?.trim();
  if (expectedModeRaw !== "test" && expectedModeRaw !== "live") {
    throw new BillingConfigError(
      "STRIPE_EXPECTED_MODE must be exactly 'test' or 'live' (fail-closed Stripe mode guard)."
    );
  }
  const actualKeyMode = detectStripeKeyMode(apiKey);
  if (!actualKeyMode) {
    throw new BillingConfigError(
      "STRIPE_SECRET_KEY has an unrecognized prefix; cannot verify Stripe mode (fail-closed)."
    );
  }
  if (actualKeyMode !== expectedModeRaw) {
    // 秘密値・prefixの残り・fingerprintは出さない。不一致の事実のみ。
    console.error(
      "[billingConfig] Stripe mode mismatch: STRIPE_EXPECTED_MODE does not match the configured secret key's mode."
    );
    throw new BillingConfigError("Stripe key mode does not match STRIPE_EXPECTED_MODE (fail-closed).");
  }

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
    expectedMode: expectedModeRaw,
  };
}

export function resolveBillingConfigFromProcessEnv(): BillingConfig {
  return resolveBillingConfig({ env: process.env });
}

/**
 * 2026-09-28追加(PO再指摘): Checkout Session作成後、Stripeが応答へ含めている
 * livemodeフィールド(追加のAPI呼び出し・権限拡大は不要)とSTRIPE_EXPECTED_MODEの
 * 一致を確認する追加防御。resolveBillingConfig()の秘密鍵prefix判定が主たるガードであり、
 * これはさらにStripe自身の申告と突き合わせる二重チェック。不一致・livemode欠落は
 * fail-closedで例外を投げる(呼び出し側の既存の失敗処理に乗せ、Sessionをユーザーへ
 * 返さない)。秘密値は一切ログへ出さない。
 */
export function assertStripeLivemodeMatchesExpectedMode(input: {
  livemode: boolean | null;
  expectedMode: StripeExpectedMode;
}): void {
  if (input.livemode === null) {
    throw new BillingConfigError(
      "Stripe response did not include livemode; cannot verify mode (fail-closed)."
    );
  }
  const actual: StripeExpectedMode = input.livemode ? "live" : "test";
  if (actual !== input.expectedMode) {
    console.error(
      "[billingConfig] Stripe livemode mismatch: Stripe's own response mode does not match STRIPE_EXPECTED_MODE."
    );
    throw new BillingConfigError("Stripe livemode does not match STRIPE_EXPECTED_MODE (fail-closed).");
  }
}
