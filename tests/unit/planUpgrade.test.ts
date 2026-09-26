import { describe, expect, it } from "vitest";
import { buildUpgradeNotice, evaluateUpgrade, upgradeTargetsFor } from "@/domain/billing/planUpgrade";

const base = { billingExempt: false, invited: false } as const;

describe("upgradeTargetsFor", () => {
  it("上位プランのみ", () => {
    expect(upgradeTargetsFor("light")).toEqual(["standard", "premium"]);
    expect(upgradeTargetsFor("standard")).toEqual(["premium"]);
    expect(upgradeTargetsFor("premium")).toEqual([]);
  });
});

describe("evaluateUpgrade", () => {
  it("許可される3経路", () => {
    expect(evaluateUpgrade({ ...base, currentPlan: "light", status: "trial", targetPlan: "standard" })).toEqual({ ok: true, proration: "none" });
    expect(evaluateUpgrade({ ...base, currentPlan: "light", status: "active", targetPlan: "premium" })).toEqual({ ok: true, proration: "always_invoice" });
    expect(evaluateUpgrade({ ...base, currentPlan: "standard", status: "active", targetPlan: "premium" }).ok).toBe(true);
  });
  it("ダウングレード・同一プランは拒否", () => {
    for (const [c, t] of [["premium", "standard"], ["premium", "light"], ["standard", "light"], ["light", "light"], ["standard", "standard"]] as const) {
      expect(evaluateUpgrade({ ...base, currentPlan: c, status: "active", targetPlan: t })).toEqual({ ok: false, reason: "not_an_upgrade" });
    }
  });
  it("免除・招待・不適格な状態は拒否", () => {
    expect(evaluateUpgrade({ ...base, billingExempt: true, currentPlan: "light", status: "active", targetPlan: "premium" })).toMatchObject({ ok: false, reason: "exempt" });
    expect(evaluateUpgrade({ ...base, invited: true, currentPlan: "light", status: "active", targetPlan: "premium" })).toMatchObject({ ok: false, reason: "exempt" });
    expect(evaluateUpgrade({ ...base, currentPlan: "light", status: "past_due", targetPlan: "premium" })).toMatchObject({ ok: false, reason: "not_upgradable_status" });
  });
});

describe("buildUpgradeNotice", () => {
  it("現在プランが足りない場合のみ案内を返す", () => {
    expect(buildUpgradeNotice({ currentPlan: "light", requiredPlan: "standard", featureLabel: "競合医院比較", gain: "10院まで" })?.ctaLabel).toBe("スタンダードプランにアップグレード");
    expect(buildUpgradeNotice({ currentPlan: "standard", requiredPlan: "standard", featureLabel: "x", gain: "y" })).toBeNull();
    expect(buildUpgradeNotice({ currentPlan: "premium", requiredPlan: "standard", featureLabel: "x", gain: "y" })).toBeNull();
  });
});
