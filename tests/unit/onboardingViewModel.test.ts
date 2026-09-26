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
      description: "スタンダードプランをご利用中です。",
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

describe("Checkout完了直後の案内文", () => {
  it("契約情報の反映前は「確認しています」を表示する", () => {
    const vm = buildOnboardingViewModel({
      subscription: null,
      hasDiagnosis: false,
      checkoutJustCompleted: true,
    });
    expect(vm.checkoutBannerMessage).toBe(
      "お申し込みを受け付けました。ご契約情報を確認しています。通常は数秒で反映されます。"
    );
  });

  it("トライアル反映後は7日間無料トライアル開始を表示する", () => {
    const vm = buildOnboardingViewModel({
      subscription: { plan: "light", status: "trial" },
      hasDiagnosis: false,
      checkoutJustCompleted: true,
    });
    expect(vm.checkoutBannerMessage).toBe(
      "お申し込みが完了しました。ライトプランの7日間無料トライアルを開始しました。"
    );
    expect(vm.steps[1]?.description).toBe("ライトプランの7日間無料トライアルを開始しました。");
  });
});
