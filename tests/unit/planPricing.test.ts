import { describe, expect, it } from "vitest";
import { PLAN_PRICES, PLAN_PRICE_LABELS } from "@/domain/billing/planPricing";

describe("確定プラン料金", () => {
  it("承認済みの月額料金を表示する", () => {
    expect(PLAN_PRICE_LABELS).toEqual({
      light: "月額14,800円（税込）",
      standard: "月額39,800円（税込）",
      premium: "月額79,800円（税込）",
    });
  });

  it("承認済み金額そのものを税込月額として保持する", () => {
    expect(PLAN_PRICES.light.monthlyYenIncludingTax).toBe(14_800);
    expect(PLAN_PRICES.standard.monthlyYenIncludingTax).toBe(39_800);
    expect(PLAN_PRICES.premium.monthlyYenIncludingTax).toBe(79_800);
  });
});
