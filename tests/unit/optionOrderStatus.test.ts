import { describe, expect, it } from "vitest";
import { canTransitionOptionOrderStatus } from "@/domain/options/optionOrderStatus";

describe("canTransitionOptionOrderStatus", () => {
  it("draft→checkout_created→paid→generation_queued→generating→generated→available→downloadedと順に進める", () => {
    expect(canTransitionOptionOrderStatus("draft", "checkout_created")).toBe(true);
    expect(canTransitionOptionOrderStatus("checkout_created", "paid")).toBe(true);
    expect(canTransitionOptionOrderStatus("paid", "generation_queued")).toBe(true);
    expect(canTransitionOptionOrderStatus("generation_queued", "generating")).toBe(true);
    expect(canTransitionOptionOrderStatus("generating", "generated")).toBe(true);
    expect(canTransitionOptionOrderStatus("generated", "available")).toBe(true);
    expect(canTransitionOptionOrderStatus("available", "downloaded")).toBe(true);
  });

  it("同じ状態への遷移は常に許可する(冪等)", () => {
    expect(canTransitionOptionOrderStatus("paid", "paid")).toBe(true);
    expect(canTransitionOptionOrderStatus("downloaded", "downloaded")).toBe(true);
  });

  it("paidからcheckout_createdへは戻れない(決済済みを未決済扱いに戻さない)", () => {
    expect(canTransitionOptionOrderStatus("paid", "checkout_created")).toBe(false);
  });

  it("生成失敗からは再度generation_queuedへ戻れる(再課金なしの再生成)", () => {
    expect(canTransitionOptionOrderStatus("generation_failed", "generation_queued")).toBe(true);
    // ただしpaidへは戻れない(既に支払い済みのため再課金経路を通らせない)
    expect(canTransitionOptionOrderStatus("generation_failed", "paid")).toBe(false);
  });

  it("決済失敗後はcheckout_createdへ再挑戦できる", () => {
    expect(canTransitionOptionOrderStatus("payment_failed", "checkout_created")).toBe(true);
  });

  it("refunded/cancelled/remeasuredは終端状態", () => {
    expect(canTransitionOptionOrderStatus("refunded", "paid")).toBe(false);
    expect(canTransitionOptionOrderStatus("cancelled", "checkout_created")).toBe(false);
    expect(canTransitionOptionOrderStatus("remeasured", "completed")).toBe(false);
  });
});
