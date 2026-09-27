import { describe, expect, it } from "vitest";
import {
  canTransitionTrialEntitlement,
  canStartCheckout,
  computePendingReservationExpiry,
  isClinicTrialEligible,
  isReservationStillValid,
  isTrialEntitlementStatus,
  isTrialPlan,
  resolveTrialCtaLabel,
  resolveTrialTerms,
  RESERVATION_PENDING_TTL_MS,
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
