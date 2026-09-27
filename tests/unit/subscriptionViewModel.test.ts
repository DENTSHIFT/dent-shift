import { describe, expect, it } from "vitest";
import { buildSubscriptionViewModel } from "@/app/dashboard/subscriptionViewModel";

describe("dashboard subscription view model", () => {
  it("未契約かつ決済準備中なら請求がないことを明示する", () => {
    expect(buildSubscriptionViewModel(null, false)).toEqual({
      planName: "プラン未選択",
      statusLabel: "未契約",
      description: "料金とオンライン契約は現在準備中です。請求は発生していません。",
      tone: "neutral",
      actionLabel: "プランを比較する",
      actionHref: "/plans",
    });
  });

  it("契約可能な未契約状態ではプラン選択を案内する", () => {
    expect(buildSubscriptionViewModel(null, true).description).toBe(
      "プランを比較してオンラインで契約できます。"
    );
  });

  it("有効な契約を日本語のプラン名と利用中で表示する", () => {
    expect(buildSubscriptionViewModel({ plan: "standard", status: "active" }, true)).toEqual(
      expect.objectContaining({
        planName: "スタンダードプラン",
        statusLabel: "利用中",
        tone: "positive",
        actionLabel: "初期設定を確認する",
        actionHref: "/onboarding",
      })
    );
  });

  it("支払い失敗を解約とせず確認中として表示する", () => {
    const vm = buildSubscriptionViewModel({ plan: "light", status: "past_due" }, true);
    expect(vm.statusLabel).toBe("お支払い確認中");
    expect(vm.description).toContain("確認後は自動的に利用中へ戻ります");
    expect(vm.statusLabel).not.toContain("解約");
  });

  it("2026-09-24: billingExempt=trueの契約は永久無料として表示する(planName等は通常どおり)", () => {
    const vm = buildSubscriptionViewModel(
      { plan: "standard", status: "active", billingExempt: true },
      true
    );
    expect(vm.statusLabel).toBe("永久無料");
    expect(vm.description).toContain("永久無料");
    expect(vm.tone).toBe("positive");
    expect(vm.planName).toBe("スタンダードプラン");
  });

  it("billingExemptがfalse/未指定の通常契約は従来どおりの表示のまま", () => {
    const vm = buildSubscriptionViewModel({ plan: "standard", status: "active" }, true);
    expect(vm.statusLabel).toBe("利用中");
  });

  it("2026-09-27: トライアル中はtrialEndsAtの実データから残り日数・終了日を表示する(固定文言ではない)", () => {
    const now = new Date("2026-09-27T00:00:00Z");
    const vm = buildSubscriptionViewModel(
      { plan: "light", status: "trial", trialEndsAt: new Date("2026-10-01T05:00:00Z") },
      true,
      now
    );
    expect(vm.statusLabel).toBe("お試し期間中");
    expect(vm.description).toContain("あと4日");
    expect(vm.description).toContain("2026/10/1");
    expect(vm.actionLabel).toBe("プランを確認する");
    expect(vm.actionHref).toBe("/plans");
  });

  it("トライアル終了当日は「本日終了」と表示し、残り日数を表示しない", () => {
    const now = new Date("2026-10-01T23:00:00Z"); // JSTでは10/2の8:00
    const vm = buildSubscriptionViewModel(
      { plan: "light", status: "trial", trialEndsAt: new Date("2026-10-02T03:00:00Z") }, // JST 10/2 12:00
      true,
      now
    );
    expect(vm.description).toContain("本日");
    expect(vm.description).not.toContain("あと");
  });

  it("トライアル終了日を過ぎている場合は「終了しました」と表示し、残り日数を表示しない", () => {
    const now = new Date("2026-10-05T00:00:00Z");
    const vm = buildSubscriptionViewModel(
      { plan: "light", status: "trial", trialEndsAt: new Date("2026-10-01T05:00:00Z") },
      true,
      now
    );
    expect(vm.description).toContain("終了しました");
    expect(vm.description).not.toContain("あと");
  });

  it("trialEndsAtが取得できない場合は、日数を捏造せず従来の一般文言のままにする", () => {
    const vm = buildSubscriptionViewModel({ plan: "light", status: "trial" }, true);
    expect(vm.description).toBe("7日間無料トライアル中です。期間中の請求は発生しません。");
  });

  it("billingExempt(永久無料)はtrialEndsAtがあっても永久無料の文言を優先する", () => {
    const vm = buildSubscriptionViewModel(
      {
        plan: "standard",
        status: "trial",
        billingExempt: true,
        trialEndsAt: new Date("2026-10-01T00:00:00Z"),
      },
      true,
      new Date("2026-09-27T00:00:00Z")
    );
    expect(vm.statusLabel).toBe("永久無料");
    expect(vm.description).toContain("永久無料");
  });

  it("停止・解約予定・解約済みを区別する", () => {
    expect(buildSubscriptionViewModel({ plan: "premium", status: "suspended" }, true).statusLabel)
      .toBe("利用停止中");
    expect(
      buildSubscriptionViewModel({ plan: "premium", status: "cancel_scheduled" }, true).statusLabel
    ).toBe("解約予定");
    expect(buildSubscriptionViewModel({ plan: "premium", status: "cancelled" }, true).statusLabel)
      .toBe("解約済み");
  });
});
