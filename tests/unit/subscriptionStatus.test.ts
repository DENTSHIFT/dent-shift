import { describe, expect, it } from "vitest";
import {
  canTransitionSubscription,
  isSubscriptionStatus,
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
