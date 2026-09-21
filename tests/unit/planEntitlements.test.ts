import { describe, expect, it } from "vitest";
import {
  currentEntitlementPeriod,
  INSTRUCTION_PDF_MONTHLY_QUOTA,
  isEntitledSubscriptionStatus,
} from "@/domain/options/planEntitlements";

describe("planEntitlements", () => {
  it("プラン別月次無料枠はplanCatalog.tsの指示書行(都度課金/月1件/月3件)と一致する", () => {
    expect(INSTRUCTION_PDF_MONTHLY_QUOTA).toEqual({ light: 0, standard: 1, premium: 3 });
  });

  it("currentEntitlementPeriodはJST(Asia/Tokyo)基準の暦月でYYYY-MMを返す", () => {
    // 2026-09-30T15:00:00Z = 2026-10-01T00:00:00 JST(9月最終日の直後、JST基準では10月入り)
    expect(currentEntitlementPeriod(new Date("2026-09-30T14:59:59Z"))).toBe("2026-09");
    expect(currentEntitlementPeriod(new Date("2026-09-30T15:00:00Z"))).toBe("2026-10");
    // UTC基準なら9/21のままの時刻でも、JSTでは既に9/22
    expect(currentEntitlementPeriod(new Date("2026-09-21T23:59:59Z"))).toBe("2026-09");
    expect(currentEntitlementPeriod(new Date("2026-09-21T15:00:00Z"))).toBe("2026-09");
  });

  it("無料枠を消費できるのはtrial/active/past_due/cancel_scheduledのみ", () => {
    expect(isEntitledSubscriptionStatus("trial")).toBe(true);
    expect(isEntitledSubscriptionStatus("active")).toBe(true);
    expect(isEntitledSubscriptionStatus("past_due")).toBe(true);
    expect(isEntitledSubscriptionStatus("cancel_scheduled")).toBe(true);
    expect(isEntitledSubscriptionStatus("restricted")).toBe(false);
    expect(isEntitledSubscriptionStatus("suspended")).toBe(false);
    expect(isEntitledSubscriptionStatus("cancelled")).toBe(false);
  });
});
