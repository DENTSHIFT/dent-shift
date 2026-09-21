import "server-only";
import { OPTION_PRODUCT_KEYS, type OptionProductKey } from "@/domain/options/optionProductCatalog";

export class OptionProductConfigError extends Error {}

// 商品key → Stripe Price IDの環境変数名。仕様書■5「product_id/price_idは環境変数
// または商品設定テーブルで管理し、コードへ直接ハードコードしない」に対応する。
// 未確定の商品は追加しない(instruction_pdfのみ)。
const STRIPE_PRICE_ID_ENV_KEYS: Record<OptionProductKey, string> = {
  instruction_pdf: "STRIPE_PRICE_ID_INSTRUCTION_PDF",
};

export interface OptionProductStripeRefs {
  key: OptionProductKey;
  stripePriceId: string;
}

/**
 * Stripe Price IDが設定されているオプション商品だけを有効として返す
 * (billingConfig.tsと同じく、未設定を明示エラーにはせず「販売不可」として扱う。
 * 指示書以外の商品は今回env自体を用意しないため、常に無効のまま)。
 */
export function resolveOptionProductStripeRefs(options: {
  env: Record<string, string | undefined>;
}): Partial<Record<OptionProductKey, OptionProductStripeRefs>> {
  const result: Partial<Record<OptionProductKey, OptionProductStripeRefs>> = {};
  for (const key of OPTION_PRODUCT_KEYS) {
    const envKey = STRIPE_PRICE_ID_ENV_KEYS[key];
    const stripePriceId = options.env[envKey]?.trim();
    if (stripePriceId) {
      result[key] = { key, stripePriceId };
    }
  }
  return result;
}

export function resolveOptionProductStripeRefsFromProcessEnv() {
  return resolveOptionProductStripeRefs({ env: process.env });
}

export function requireOptionProductStripeRef(
  key: OptionProductKey,
  refs: Partial<Record<OptionProductKey, OptionProductStripeRefs>>
): OptionProductStripeRefs {
  const ref = refs[key];
  if (!ref) {
    throw new OptionProductConfigError(
      `${STRIPE_PRICE_ID_ENV_KEYS[key]} is not configured; option product '${key}' is unavailable.`
    );
  }
  return ref;
}
