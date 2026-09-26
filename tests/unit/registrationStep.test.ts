import { describe, expect, it } from "vitest";
import { canTransitionRegistrationStep } from "@/domain/auth/registrationStep";

describe("canTransitionRegistrationStep", () => {
  it("順番通りの前進を許可する", () => {
    expect(canTransitionRegistrationStep("profile", "sms")).toBe(true);
    expect(canTransitionRegistrationStep("sms", "email")).toBe(true);
    expect(canTransitionRegistrationStep("email", "consent")).toBe(true);
    expect(canTransitionRegistrationStep("consent", "payment")).toBe(true);
    expect(canTransitionRegistrationStep("payment", "completed")).toBe(true);
  });

  it("ステップを飛ばした前進も許可する(冪等な再送・リトライのため)", () => {
    expect(canTransitionRegistrationStep("profile", "completed")).toBe(true);
  });

  it("同一ステップへの再遷移を許可する", () => {
    expect(canTransitionRegistrationStep("sms", "sms")).toBe(true);
  });

  it("後退は許可しない", () => {
    expect(canTransitionRegistrationStep("payment", "sms")).toBe(false);
    expect(canTransitionRegistrationStep("payment", "consent")).toBe(false);
    expect(canTransitionRegistrationStep("completed", "profile")).toBe(false);
  });

  it("未知のステップ名は拒否する", () => {
    // @ts-expect-error 意図的に不正な値を渡す
    expect(canTransitionRegistrationStep("profile", "unknown")).toBe(false);
  });
});
