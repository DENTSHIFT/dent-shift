import { describe, expect, it } from "vitest";
import {
  canTransitionSubscription,
  isSubscriptionStatus,
  blocksNewCheckout,
  hasExistingSubscription,
} from "@/domain/billing/subscriptionStatus";

describe("契約状態の遷移", () => {
  it("支払遅延から入金済みへ自動復旧できる", () => {
    expect(canTransitionSubscription("past_due", "active")).toBe(true);
  });

  it("契約終了から勝手に再開しない", () => {
    expect(canTransitionSubscription("cancelled", "active")).toBe(false);
  });

  it("同じ状態の再通知は冪等に受け付ける", () => {
    expect(canTransitionSubscription("active", "active")).toBe(true);
  });

  it("定義外の状態を拒否する", () => {
    expect(isSubscriptionStatus("active")).toBe(true);
    expect(isSubscriptionStatus("unknown")).toBe(false);
  });
});

describe("二重契約防止のブロック判定", () => {
  it.each(["trial", "active", "past_due", "restricted", "suspended", "cancel_scheduled"] as const)(
    "status=%sは新規Checkoutをブロックする",
    (status) => {
      expect(blocksNewCheckout(status)).toBe(true);
    }
  );

  it("cancelledは新規Checkoutをブロックしない", () => {
    expect(blocksNewCheckout("cancelled")).toBe(false);
  });

  it("サブスクリプションが存在しない場合はブロックしない(未契約)", () => {
    expect(hasExistingSubscription(null)).toBe(false);
  });

  it("active契約はブロックする", () => {
    expect(hasExistingSubscription({ status: "active", billingExempt: false })).toBe(true);
  });

  it("trial契約はブロックする", () => {
    expect(hasExistingSubscription({ status: "trial", billingExempt: false })).toBe(true);
  });

  it("billingExempt(永久無料)は状態にかかわらずブロックする", () => {
    expect(hasExistingSubscription({ status: "cancelled", billingExempt: true })).toBe(true);
  });

  it("cancelled契約はブロックしない(再契約を許可)", () => {
    expect(hasExistingSubscription({ status: "cancelled", billingExempt: false })).toBe(false);
  });
});
