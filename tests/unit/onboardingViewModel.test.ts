import { describe, expect, it } from "vitest";
import { buildOnboardingViewModel } from "@/app/onboarding/onboardingViewModel";

describe("onboarding view model", () => {
  it("決済直後でWebhook反映前なら契約確認中として案内する", () => {
    const vm = buildOnboardingViewModel({
      subscription: null,
      hasDiagnosis: false,
      checkoutJustCompleted: true,
    });

    expect(vm.steps[1]).toEqual(expect.objectContaining({
      key: "contract",
      state: "pending",
      stateLabel: "反映を確認中",
    }));
    expect(vm.steps[2]).toEqual(expect.objectContaining({ state: "pending" }));
  });

  it("有効契約後は初回診断を次の作業として案内する", () => {
    const vm = buildOnboardingViewModel({
      subscription: { plan: "standard", status: "active" },
      hasDiagnosis: false,
      checkoutJustCompleted: false,
    });

    expect(vm.steps[1]).toEqual(expect.objectContaining({
      state: "complete",
      description: "スタンダードプランが反映されています。",
    }));
    expect(vm.steps[2]).toEqual(expect.objectContaining({
      state: "current",
      actionHref: "/diagnosis",
    }));
    expect(vm.completedCount).toBe(2);
    expect(vm.isComplete).toBe(false);
  });

  it("契約と診断が揃えば必須の初期設定を完了とする", () => {
    const vm = buildOnboardingViewModel({
      subscription: { plan: "premium", status: "cancel_scheduled" },
      hasDiagnosis: true,
      latestDiagnosisId: "diagnosis-1",
      checkoutJustCompleted: false,
    });

    expect(vm.isComplete).toBe(true);
    expect(vm.completedCount).toBe(3);
    expect(vm.steps[2]).toEqual(expect.objectContaining({
      actionHref: "/diagnosis/result/diagnosis-1",
    }));
  });

  it("支払い確認が必要な契約を完了扱いにしない", () => {
    const vm = buildOnboardingViewModel({
      subscription: { plan: "light", status: "past_due" },
      hasDiagnosis: true,
      checkoutJustCompleted: false,
    });

    expect(vm.steps[1]).toEqual(expect.objectContaining({
      state: "attention",
      stateLabel: "要確認",
    }));
    expect(vm.isComplete).toBe(false);
  });
});
