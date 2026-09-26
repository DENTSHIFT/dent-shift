import { describe, expect, it } from "vitest";
import { resolveRegistrationBannerKind } from "@/app/dashboard/RegistrationProgressBanner";

describe("resolveRegistrationBannerKind", () => {
  it("registrationStep==='email'は常にemailバナー", () => {
    expect(resolveRegistrationBannerKind("email", false, false)).toBe("email");
    expect(resolveRegistrationBannerKind("email", true, false)).toBe("email");
  });

  it("registrationStep==='consent'は契約有無に関わらずconsentバナー", () => {
    expect(resolveRegistrationBannerKind("consent", true, false)).toBe("consent");
    expect(resolveRegistrationBannerKind("consent", false, false)).toBe("consent");
  });

  it("registrationStep==='payment'で同意済み・契約なしならpaymentバナー", () => {
    expect(resolveRegistrationBannerKind("payment", false, true)).toBe("payment");
  });

  it("registrationStep==='payment'でも未同意・契約なしならconsentバナー(旧フローの行き止まり防止)", () => {
    expect(resolveRegistrationBannerKind("payment", false, false)).toBe("consent");
  });

  it("2026-09-24: registrationStep==='payment'でもhasActiveSubscription===trueならバナーを出さない(Pilot/永久無料の誤ったCTA抑制)", () => {
    expect(resolveRegistrationBannerKind("payment", true, false)).toBe("none");
    expect(resolveRegistrationBannerKind("payment", true, true)).toBe("none");
  });

  it("sms/profile/completed等は何も出さない", () => {
    expect(resolveRegistrationBannerKind("sms", false, false)).toBe("none");
    expect(resolveRegistrationBannerKind("profile", false, false)).toBe("none");
    expect(resolveRegistrationBannerKind("completed", true, true)).toBe("none");
  });
});
