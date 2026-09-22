import { describe, expect, it } from "vitest";
import {
  COMPETITOR_DISPLAY_LIMIT,
  isPlanId,
  PLAN_FEATURE_ROWS,
  PLAN_SUMMARIES,
} from "@/domain/billing/planCatalog";

describe("プラン比較カタログ", () => {
  it("3プランを重複なく定義する", () => {
    expect(PLAN_SUMMARIES.map((plan) => plan.id)).toEqual(["light", "standard", "premium"]);
    expect(PLAN_SUMMARIES.filter((plan) => plan.recommended)).toHaveLength(1);
  });

  it("料金をカタログへハードコードしない", () => {
    expect(JSON.stringify(PLAN_SUMMARIES)).not.toMatch(/[¥￥]\s*\d|月額\s*\d/);
    expect(PLAN_FEATURE_ROWS.length).toBeGreaterThan(10);
  });

  it("許可されたプランIDだけを受け付ける", () => {
    expect(isPlanId("standard")).toBe(true);
    expect(isPlanId("enterprise")).toBe(false);
  });

  it("競合医院の表示件数上限はPLAN_FEATURE_ROWSの「競合医院」行(3院/10院/20院)と一致する", () => {
    expect(COMPETITOR_DISPLAY_LIMIT).toEqual({ light: 3, standard: 10, premium: 20 });
  });
});
