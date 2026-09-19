import { describe, expect, it } from "vitest";
import { canTransitionAttribution, isAttributionStatus } from "@/domain/ambassador/attributionStatus";

describe("canTransitionAttribution", () => {
  it("pendingからconfirmedへの遷移を許可する(有料契約+初回入金確定時点)", () => {
    expect(canTransitionAttribution("pending", "confirmed")).toBe(true);
  });

  it("同一状態への再遷移を許可する(冪等な再送のため)", () => {
    expect(canTransitionAttribution("pending", "pending")).toBe(true);
    expect(canTransitionAttribution("confirmed", "confirmed")).toBe(true);
  });

  it("confirmedからpendingへの後退は許可しない(成果の取り消し禁止)", () => {
    expect(canTransitionAttribution("confirmed", "pending")).toBe(false);
  });
});

describe("isAttributionStatus", () => {
  it("既知の状態を許可する", () => {
    expect(isAttributionStatus("pending")).toBe(true);
    expect(isAttributionStatus("confirmed")).toBe(true);
  });

  it("未知の状態を拒否する", () => {
    expect(isAttributionStatus("cancelled")).toBe(false);
  });
});
