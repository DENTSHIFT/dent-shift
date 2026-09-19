import { describe, expect, it } from "vitest";
import { computeTrialEndsAt, isEligibleForTrialActivation } from "@/domain/billing/trialActivation";

const ALL_COMPLETE = {
  phoneVerifiedAt: new Date("2026-09-01T00:00:00Z"),
  emailVerifiedAt: new Date("2026-09-01T00:00:00Z"),
  consentAcceptedAt: new Date("2026-09-01T00:00:00Z"),
  paymentMethodStatus: "completed",
  trialStartedAt: null,
};

describe("isEligibleForTrialActivation", () => {
  it("SMS・メール・規約同意・決済方法がすべて揃った場合のみtrue", () => {
    expect(isEligibleForTrialActivation(ALL_COMPLETE)).toBe(true);
  });

  it("SMS未認証ならfalse", () => {
    expect(isEligibleForTrialActivation({ ...ALL_COMPLETE, phoneVerifiedAt: null })).toBe(false);
  });

  it("メール未確認ならfalse", () => {
    expect(isEligibleForTrialActivation({ ...ALL_COMPLETE, emailVerifiedAt: null })).toBe(false);
  });

  it("規約未同意ならfalse", () => {
    expect(isEligibleForTrialActivation({ ...ALL_COMPLETE, consentAcceptedAt: null })).toBe(false);
  });

  it("決済方法未登録ならfalse", () => {
    expect(
      isEligibleForTrialActivation({ ...ALL_COMPLETE, paymentMethodStatus: "pending" })
    ).toBe(false);
  });

  it("既にtrial開始済みなら二重設定を防ぐためfalse", () => {
    expect(
      isEligibleForTrialActivation({ ...ALL_COMPLETE, trialStartedAt: new Date("2026-09-01T00:00:00Z") })
    ).toBe(false);
  });
});

describe("computeTrialEndsAt", () => {
  it("開始日時から7日後を返す", () => {
    const start = new Date("2026-09-01T00:00:00.000Z");
    expect(computeTrialEndsAt(start).toISOString()).toBe("2026-09-08T00:00:00.000Z");
  });
});
