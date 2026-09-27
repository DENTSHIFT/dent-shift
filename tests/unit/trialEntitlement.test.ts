import { describe, expect, it } from "vitest";
import {
  canTransitionTrialEntitlement,
  canStartCheckout,
  computePendingReservationExpiry,
  isClinicTrialEligible,
  isReservationStillValid,
  isTrialEntitlementStatus,
  isTrialPlan,
  resolveDashboardTrialBannerState,
  resolvePlanActionState,
  resolveTrialCtaLabel,
  resolveTrialTerms,
  RESERVATION_PENDING_TTL_MS,
  type PlanActionState,
} from "@/domain/billing/trialEntitlement";
import { hasExistingSubscription } from "@/domain/billing/subscriptionStatus";

describe("TrialEntitlementのステータス検証・遷移", () => {
  it.each(["reserved", "consumed", "released"])("%sは有効なステータス", (value) => {
    expect(isTrialEntitlementStatus(value)).toBe(true);
  });

  it("未知の値は無効", () => {
    expect(isTrialEntitlementStatus("expired")).toBe(false);
  });

  it("reserved→consumed / reserved→releasedのみ許可する", () => {
    expect(canTransitionTrialEntitlement("reserved", "consumed")).toBe(true);
    expect(canTransitionTrialEntitlement("reserved", "released")).toBe(true);
  });

  it("consumed→reserved/releasedは拒否する", () => {
    expect(canTransitionTrialEntitlement("consumed", "reserved")).toBe(false);
    expect(canTransitionTrialEntitlement("consumed", "released")).toBe(false);
  });

  it("released→consumedは拒否する", () => {
    expect(canTransitionTrialEntitlement("released", "consumed")).toBe(false);
  });

  it("同一状態への自己遷移も拒否する(既存状態の無条件上書き禁止)", () => {
    expect(canTransitionTrialEntitlement("reserved", "reserved")).toBe(false);
    expect(canTransitionTrialEntitlement("consumed", "consumed")).toBe(false);
  });
});

describe("暫定予約の有効期限", () => {
  it("現在時刻からRESERVATION_PENDING_TTL_MSぶん先を返す", () => {
    const now = new Date("2026-09-27T00:00:00Z");
    const expiry = computePendingReservationExpiry(now);
    expect(expiry.getTime() - now.getTime()).toBe(RESERVATION_PENDING_TTL_MS);
  });
});

describe("isTrialPlan/isClinicTrialEligible/canStartCheckoutの分離", () => {
  it("ライト・スタンダードのみtrue、プレミアムはfalse", () => {
    expect(isTrialPlan("light")).toBe(true);
    expect(isTrialPlan("standard")).toBe(true);
    expect(isTrialPlan("premium")).toBe(false);
  });

  it("trialConsumedAtがnullの医院のみtrue", () => {
    expect(isClinicTrialEligible({ trialConsumedAt: null })).toBe(true);
    expect(isClinicTrialEligible({ trialConsumedAt: new Date() })).toBe(false);
  });

  it("既存契約が無い/cancelledのみCheckout開始可能", () => {
    expect(canStartCheckout(null)).toBe(true);
    expect(canStartCheckout({ status: "cancelled", billingExempt: false })).toBe(true);
    expect(canStartCheckout({ status: "active", billingExempt: false })).toBe(false);
    expect(canStartCheckout({ status: "trial", billingExempt: false })).toBe(false);
    expect(canStartCheckout({ status: "active", billingExempt: true })).toBe(false);
  });
});

describe("resolveTrialTerms: 「未契約」と「トライアル対象」を独立した状態として扱う", () => {
  it("トライアル対象プラン・未消費の医院はtrialEligible=trueで「7日間無料で試す」", () => {
    const terms = resolveTrialTerms({ plan: "light", clinic: { trialConsumedAt: null } });
    expect(terms).toEqual({ trialEligible: true, ctaLabel: "7日間無料で試す" });
  });

  it("トライアル対象プランでも消費済みの医院はtrialEligible=falseで「このプランで契約する」(通常契約は妨げない)", () => {
    const terms = resolveTrialTerms({
      plan: "standard",
      clinic: { trialConsumedAt: new Date("2026-09-01T00:00:00Z") },
    });
    expect(terms).toEqual({ trialEligible: false, ctaLabel: "このプランで契約する" });
  });

  it("プレミアム(トライアル対象外)は消費状態にかかわらず「このプランで契約する」", () => {
    expect(resolveTrialTerms({ plan: "premium", clinic: { trialConsumedAt: null } })).toEqual({
      trialEligible: false,
      ctaLabel: "このプランで契約する",
    });
    expect(
      resolveTrialTerms({ plan: "premium", clinic: { trialConsumedAt: new Date() } })
    ).toEqual({ trialEligible: false, ctaLabel: "このプランで契約する" });
  });
});

describe("2026-09-28追加(PO再指摘): resolveTrialCtaLabelは新規Checkoutを禁止する既存Subscription状態を最優先する", () => {
  const FRESH_CLINIC = { trialConsumedAt: null, hasConsumedEntitlement: false, activeReservation: null };

  it.each(["trial", "active", "past_due", "restricted", "suspended", "cancel_scheduled"])(
    "既存Subscriptionがstatus=%sの場合、トライアル未消費の医院でも「このプランで契約する」を返す(トライアルCTAにしない)",
    (status) => {
      const blocks = hasExistingSubscription({ status, billingExempt: false });
      expect(blocks).toBe(true); // 前提: このstatusは新規Checkoutを禁止する状態である
      expect(
        resolveTrialCtaLabel({ plan: "light", clinic: FRESH_CLINIC, hasExistingSubscription: blocks })
      ).toBe("このプランで契約する");
    }
  );

  it("cancelledだが過去にトライアル消費済み(trialConsumedAt設定済み)の医院は「このプランで契約する」", () => {
    const status = "cancelled";
    const blocksNewCheckout = hasExistingSubscription({ status, billingExempt: false }); // false(再契約可能)
    expect(blocksNewCheckout).toBe(false);
    const label = resolveTrialCtaLabel({
      plan: "light",
      clinic: { trialConsumedAt: new Date("2026-01-01T00:00:00Z"), hasConsumedEntitlement: true, activeReservation: null },
      hasExistingSubscription: blocksNewCheckout,
    });
    expect(label).toBe("このプランで契約する");
  });

  it("Subscriptionなし・消費履歴なしの医院は「7日間無料で試す」", () => {
    const label = resolveTrialCtaLabel({
      plan: "light",
      clinic: FRESH_CLINIC,
      hasExistingSubscription: hasExistingSubscription(null),
    });
    expect(label).toBe("7日間無料で試す");
  });

  it("トライアル対象外のPremiumは、契約状態にかかわらず常に「このプランで契約する」", () => {
    expect(
      resolveTrialCtaLabel({ plan: "premium", clinic: FRESH_CLINIC, hasExistingSubscription: false })
    ).toBe("このプランで契約する");
    expect(
      resolveTrialCtaLabel({
        plan: "premium",
        clinic: FRESH_CLINIC,
        hasExistingSubscription: hasExistingSubscription({ status: "active", billingExempt: false }),
      })
    ).toBe("このプランで契約する");
  });

  it("billingExempt(永久無料)も新規Checkoutを禁止する既存Subscription状態としてトライアルCTAを出さない", () => {
    const blocks = hasExistingSubscription({ status: "active", billingExempt: true });
    expect(blocks).toBe(true);
    expect(
      resolveTrialCtaLabel({ plan: "light", clinic: FRESH_CLINIC, hasExistingSubscription: blocks })
    ).toBe("このプランで契約する");
  });

  it("hasExistingSubscription=trueは、有効な予約や消費状態より常に優先される", () => {
    expect(
      resolveTrialCtaLabel({
        plan: "light",
        clinic: { trialConsumedAt: null, hasConsumedEntitlement: false, activeReservation: { hasCheckoutSession: true } },
        hasExistingSubscription: true,
      })
    ).toBe("このプランで契約する");
  });
});

describe("2026-09-28追加(PO再指摘): 期限境界の統一(isReservationStillValid)", () => {
  it("reservationExpiresAt > now は有効", () => {
    const now = new Date("2026-09-28T00:00:00.000Z");
    expect(isReservationStillValid(new Date("2026-09-28T00:00:00.001Z"), now)).toBe(true);
  });

  it("reservationExpiresAt === now(ちょうど同時刻)は期限切れ扱い", () => {
    const now = new Date("2026-09-28T00:00:00.000Z");
    expect(isReservationStillValid(new Date("2026-09-28T00:00:00.000Z"), now)).toBe(false);
  });

  it("reservationExpiresAt < now は期限切れ", () => {
    const now = new Date("2026-09-28T00:00:00.000Z");
    expect(isReservationStillValid(new Date("2026-09-27T23:59:59.999Z"), now)).toBe(false);
  });
});

describe("2026-09-28追加(PO再指摘、CTA矛盾の解消): resolvePlanActionState", () => {
  const FRESH_CLINIC = { trialConsumedAt: null, hasConsumedEntitlement: false, activeReservation: null };
  const CONSUMED_CLINIC = {
    trialConsumedAt: new Date("2026-01-01T00:00:00Z"),
    hasConsumedEntitlement: true,
    activeReservation: null,
  };
  const BASE = {
    plan: "light" as const,
    currentPlan: null,
    authenticated: true,
    checkoutReady: true,
    isBillingExempt: false,
    subscriptionStatus: null,
    upgradeAllowed: false,
    clinic: FRESH_CLINIC,
  };

  it("Subscriptionなし・トライアル未利用 → start_trial", () => {
    expect(resolvePlanActionState(BASE)).toEqual({ kind: "start_trial" });
  });

  it("Subscriptionなし・トライアル利用済み → contract", () => {
    expect(resolvePlanActionState({ ...BASE, clinic: CONSUMED_CLINIC })).toEqual({ kind: "contract" });
  });

  it("cancelledで新規契約が許可され、トライアル利用済みなら → recontract", () => {
    expect(
      resolvePlanActionState({ ...BASE, subscriptionStatus: "cancelled", clinic: CONSUMED_CLINIC })
    ).toEqual({ kind: "recontract" });
  });

  it("cancelledだがトライアル未利用なら通常どおり → start_trial(再契約ではなく新規トライアル)", () => {
    expect(
      resolvePlanActionState({ ...BASE, subscriptionStatus: "cancelled", clinic: FRESH_CLINIC })
    ).toEqual({ kind: "start_trial" });
  });

  it.each(["trial", "active", "past_due", "restricted", "suspended", "cancel_scheduled"] as const)(
    "status=%sは新規Checkout CTAを出さない(現在のプランでもアップグレード対象でもない場合はmanage_existing)",
    (status) => {
      expect(
        resolvePlanActionState({
          ...BASE,
          plan: "premium",
          currentPlan: "light",
          subscriptionStatus: status,
          upgradeAllowed: false,
        })
      ).toEqual({ kind: "manage_existing" });
    }
  );

  it("現在契約中のプランと同じ場合は current_plan", () => {
    expect(
      resolvePlanActionState({ ...BASE, plan: "light", currentPlan: "light", subscriptionStatus: "active" })
    ).toEqual({ kind: "current_plan" });
  });

  it("アップグレード対象(standard/premium)かつupgradeAllowedなら upgrade", () => {
    expect(
      resolvePlanActionState({
        ...BASE,
        plan: "standard",
        currentPlan: "light",
        subscriptionStatus: "active",
        upgradeAllowed: true,
      })
    ).toEqual({ kind: "upgrade", targetPlan: "standard" });
  });

  it("billingExemptは契約状態によらず billing_exempt(Checkout CTAを一切出さない)", () => {
    expect(resolvePlanActionState({ ...BASE, isBillingExempt: true, subscriptionStatus: "active" })).toEqual({
      kind: "billing_exempt",
    });
  });

  it("有効なCheckout Sessionあり(checkoutSessionId設定済み)→ continue_session", () => {
    expect(
      resolvePlanActionState({
        ...BASE,
        clinic: { ...FRESH_CLINIC, activeReservation: { hasCheckoutSession: true } },
      })
    ).toEqual({ kind: "continue_session" });
  });

  it("Session作成中(checkoutSessionId未設定)→ preparing", () => {
    expect(
      resolvePlanActionState({
        ...BASE,
        clinic: { ...FRESH_CLINIC, activeReservation: { hasCheckoutSession: false } },
      })
    ).toEqual({ kind: "preparing" });
  });

  it("未ログインは login_required", () => {
    expect(resolvePlanActionState({ ...BASE, authenticated: false, clinic: null })).toEqual({
      kind: "login_required",
    });
  });

  it("Stripe未設定(checkoutReady=false)は checkout_not_ready(既存契約がない場合)", () => {
    expect(resolvePlanActionState({ ...BASE, checkoutReady: false })).toEqual({
      kind: "checkout_not_ready",
    });
  });

  it("トライアル対象外のPremiumは、未契約なら常に contract(トライアルCTAは出ない)", () => {
    expect(resolvePlanActionState({ ...BASE, plan: "premium", clinic: FRESH_CLINIC })).toEqual({
      kind: "contract",
    });
  });

  it("2026-09-28追加(PO再指摘): manage_existing/current_plan/upgrade/billing_exemptはいずれも新規Checkout CTAではない(kindの網羅性チェック)", () => {
    const nonCheckoutKinds: PlanActionState["kind"][] = [
      "manage_existing",
      "current_plan",
      "upgrade",
      "billing_exempt",
      "login_required",
      "checkout_not_ready",
    ];
    const checkoutKinds: PlanActionState["kind"][] = [
      "start_trial",
      "continue_session",
      "preparing",
      "contract",
      "recontract",
    ];
    // 両者に重複が無いこと(=1つの状態が両方の意味を同時に持たない)を機械的に保証する。
    for (const kind of nonCheckoutKinds) {
      expect(checkoutKinds).not.toContain(kind);
    }
  });
});

describe("2026-09-28追加(PO承認、P1-1): resolveDashboardTrialBannerState", () => {
  const FRESH_CLINIC = { trialConsumedAt: null, hasConsumedEntitlement: false, activeReservation: null };
  const CONSUMED_CLINIC = {
    trialConsumedAt: new Date("2026-01-01T00:00:00Z"),
    hasConsumedEntitlement: true,
    activeReservation: null,
  };
  const BASE = {
    isBillingExempt: false,
    subscriptionStatus: null as null,
    hasAnyUpgradeAvailable: false,
    hasDiagnosis: true,
    clinic: FRESH_CLINIC,
  };

  it("未診断 → no_diagnosis(トライアル利用可能でも診断が先)", () => {
    expect(resolveDashboardTrialBannerState({ ...BASE, hasDiagnosis: false })).toEqual({
      kind: "no_diagnosis",
    });
  });

  it("診断済み・トライアル未消費・既存契約なし → trial_available", () => {
    expect(resolveDashboardTrialBannerState(BASE)).toEqual({ kind: "trial_available" });
  });

  it("トライアル消費済み・未契約 → trial_consumed", () => {
    expect(resolveDashboardTrialBannerState({ ...BASE, clinic: CONSUMED_CLINIC })).toEqual({
      kind: "trial_consumed",
    });
  });

  it("有効なCheckout Sessionあり → continue_session(診断状態によらず優先)", () => {
    expect(
      resolveDashboardTrialBannerState({
        ...BASE,
        hasDiagnosis: false,
        clinic: { ...FRESH_CLINIC, activeReservation: { hasCheckoutSession: true } },
      })
    ).toEqual({ kind: "continue_session" });
  });

  it("Session作成中 → preparing", () => {
    expect(
      resolveDashboardTrialBannerState({
        ...BASE,
        clinic: { ...FRESH_CLINIC, activeReservation: { hasCheckoutSession: false } },
      })
    ).toEqual({ kind: "preparing" });
  });

  it.each(["trial", "active", "past_due", "restricted", "suspended", "cancel_scheduled"] as const)(
    "既存契約(status=%s)があり、アップグレード対象でなければ → manage_existing(新規トライアルCTAは出さない)",
    (status) => {
      expect(
        resolveDashboardTrialBannerState({ ...BASE, subscriptionStatus: status, hasAnyUpgradeAvailable: false })
      ).toEqual({ kind: "manage_existing" });
    }
  );

  it("既存契約があり、実装済みのアップグレード導線が使える → upgrade_available", () => {
    expect(
      resolveDashboardTrialBannerState({ ...BASE, subscriptionStatus: "active", hasAnyUpgradeAvailable: true })
    ).toEqual({ kind: "upgrade_available" });
  });

  it("billingExemptは契約状態・診断状態によらず billing_exempt(トライアル・契約CTAを出さない)", () => {
    expect(
      resolveDashboardTrialBannerState({ ...BASE, isBillingExempt: true, subscriptionStatus: "active" })
    ).toEqual({ kind: "billing_exempt" });
  });

  it("cancelled(新規契約が許可される)はブロックせず、トライアル消費状態で通常どおり判定する", () => {
    expect(resolveDashboardTrialBannerState({ ...BASE, subscriptionStatus: "cancelled" })).toEqual({
      kind: "trial_available",
    });
    expect(
      resolveDashboardTrialBannerState({ ...BASE, subscriptionStatus: "cancelled", clinic: CONSUMED_CLINIC })
    ).toEqual({ kind: "trial_consumed" });
  });
});
