/**
 * AIオプション商品のカタログ(仕様書Ver1、2026-09-21)。
 * 現時点で確定しているのは「制作会社向け修正指示書」のみ。他のオプション商品名・価格は
 * 未確定のため、ここへ推測で追加しない(仕様書■13「未確定事項」)。
 * 価格はplanPricing.tsと同じ方針で、コード内の単一の情報源として定義する
 * (Stripe Price IDは別途環境変数で管理し、この金額と対応させる)。
 */
export const OPTION_PRODUCT_KEYS = ["instruction_pdf"] as const;
export type OptionProductKey = (typeof OPTION_PRODUCT_KEYS)[number];

export interface OptionProductDefinition {
  key: OptionProductKey;
  name: string;
  description: string;
  deliveryType: "pdf";
  priceJpy: number;
  displayLabel: string;
}

export const OPTION_PRODUCTS: Readonly<Record<OptionProductKey, OptionProductDefinition>> = {
  instruction_pdf: {
    key: "instruction_pdf",
    name: "制作会社向け修正指示書",
    description:
      "改善項目に基づき、現在の制作会社へ共有するための修正指示書(PDF)を1件生成します。",
    deliveryType: "pdf",
    priceJpy: 3_300,
    displayLabel: "3,300円（税込）/ 1件",
  },
} as const;

export function isOptionProductKey(value: string): value is OptionProductKey {
  return (OPTION_PRODUCT_KEYS as readonly string[]).includes(value);
}
