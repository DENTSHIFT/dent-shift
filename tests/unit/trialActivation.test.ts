import { describe, expect, it } from "vitest";
import {
  evaluateCheckoutEligibility,
  isRegistrationComplete,
  isTrialEligiblePlan,
  TRIAL_PERIOD_DAYS,
} from "@/domain/billing/trialActivation";

describe("isTrialEligiblePlan", () => {
  it("ライト・スタンダードはtrue、プレミアムはfalse", () => {
    expect(isTrialEligiblePlan("light")).toBe(true);
    expect(isTrialEligiblePlan("standard")).toBe(true);
    expect(isTrialEligiblePlan("premium")).toBe(false);
  });

  it("TRIAL_PERIOD_DAYSは7", () => {
    expect(TRIAL_PERIOD_DAYS).toBe(7);
  });
});

const D = new Date("2026-09-01T00:00:00Z");
const READY = {
  phoneVerifiedAt: D,
  smsVerificationExempt: false,
  emailVerifiedAt: D,
  consentAcceptedAt: D,
};

describe("evaluateCheckoutEligibility(Checkout開始条件)", () => {
  it("SMS・メール・規約同意がすべて揃えばok", () => {
    expect(evaluateCheckoutEligibility(READY)).toEqual({ ok: true });
  });

  it("SMS未認証ならCheckout不可", () => {
    expect(evaluateCheckoutEligibility({ ...READY, phoneVerifiedAt: null })).toEqual({
      ok: false,
      missing: "sms",
    });
  });

  it("SMS未認証でもsmsVerificationExempt(運営の個別例外)ならSMS条件は免除", () => {
    expect(
      evaluateCheckoutEligibility({ ...READY, phoneVerifiedAt: null, smsVerificationExempt: true })
    ).toEqual({ ok: true });
  });

  it("メール未確認ならCheckout不可", () => {
    expect(evaluateCheckoutEligibility({ ...READY, emailVerifiedAt: null })).toEqual({
      ok: false,
      missing: "email",
    });
  });

  it("規約未同意ならCheckout不可", () => {
    expect(evaluateCheckoutEligibility({ ...READY, consentAcceptedAt: null })).toEqual({
      ok: false,
      missing: "consent",
    });
  });

  it("smsVerificationExemptでもメール確認・規約同意は免除されない", () => {
    expect(
      evaluateCheckoutEligibility({
        ...READY,
        phoneVerifiedAt: null,
        smsVerificationExempt: true,
        consentAcceptedAt: null,
      })
    ).toEqual({ ok: false, missing: "consent" });
  });
});

describe("isRegistrationComplete", () => {
  it("Checkout条件に加えて決済方法登録済みでtrue", () => {
    expect(isRegistrationComplete({ ...READY, paymentMethodStatus: "completed" })).toBe(true);
  });

  it("決済方法未登録ならfalse", () => {
    expect(isRegistrationComplete({ ...READY, paymentMethodStatus: "pending" })).toBe(false);
    expect(isRegistrationComplete({ ...READY, paymentMethodStatus: null })).toBe(false);
  });

  it("規約未同意ならfalse", () => {
    expect(
      isRegistrationComplete({ ...READY, consentAcceptedAt: null, paymentMethodStatus: "completed" })
    ).toBe(false);
  });
});
