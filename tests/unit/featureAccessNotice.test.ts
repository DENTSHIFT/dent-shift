import { describe, expect, it } from "vitest";
import { resolveFeatureAccessNotice } from "@/app/dashboard/featureAccessNotice";

describe("resolveFeatureAccessNotice(ダッシュボードの利用制限案内)", () => {
  it.each(["active", "trial", "cancel_scheduled"] as const)(
    "status=%sは案内(制限)を持たない(通常表示)",
    (status) => {
      expect(resolveFeatureAccessNotice(status)).toBeNull();
    }
  );

  it("past_dueはお支払い確認の案内とCustomer PortalへのPOST遷移を持つ", () => {
    const notice = resolveFeatureAccessNotice("past_due");
    expect(notice?.heading).toContain("お支払い");
    expect(notice?.ctaMethod).toBe("post");
    expect(notice?.ctaHref).toBe("/api/billing/portal");
    // 技術用語(ステータス名)を利用者向け文言に出さない。
    expect(notice?.body).not.toMatch(/past_due|restricted|suspended|cancelled/i);
  });

  it.each(["restricted", "suspended"] as const)(
    "status=%sは利用停止の案内とCustomer PortalへのPOST遷移を持つ",
    (status) => {
      const notice = resolveFeatureAccessNotice(status);
      expect(notice?.heading).toContain("ご利用いただけません");
      expect(notice?.ctaMethod).toBe("post");
    }
  );

  it("cancelledは再契約導線(/plansへのGET遷移)を持つ", () => {
    const notice = resolveFeatureAccessNotice("cancelled");
    expect(notice?.ctaLabel).toBe("再契約する");
    expect(notice?.ctaMethod).toBe("get");
    expect(notice?.ctaHref).toBe("/plans");
  });
});
