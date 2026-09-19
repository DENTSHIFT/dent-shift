import type { PlanId } from "./planCatalog";

export interface PlanPrice {
  monthlyYenIncludingTax: number;
  displayLabel: string;
}

export const PLAN_PRICES: Readonly<Record<PlanId, PlanPrice>> = {
  light: {
    monthlyYenIncludingTax: 14_800,
    displayLabel: "月額14,800円（税込）",
  },
  standard: {
    monthlyYenIncludingTax: 39_800,
    displayLabel: "月額39,800円（税込）",
  },
  premium: {
    monthlyYenIncludingTax: 79_800,
    displayLabel: "月額79,800円（税込）",
  },
} as const;

export const PLAN_PRICE_LABELS: Readonly<Record<PlanId, string>> = {
  light: PLAN_PRICES.light.displayLabel,
  standard: PLAN_PRICES.standard.displayLabel,
  premium: PLAN_PRICES.premium.displayLabel,
} as const;
