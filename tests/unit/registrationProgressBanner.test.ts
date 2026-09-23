import { describe, expect, it } from "vitest";
import { resolveRegistrationBannerKind } from "@/app/dashboard/RegistrationProgressBanner";

describe("resolveRegistrationBannerKind", () => {
  it("registrationStep==='email'は常にemailバナー", () => {
    expect(resolveRegistrationBannerKind("email", false)).toBe("email");
    expect(resolveRegistrationBannerKind("email", true)).toBe("email");
  });

  it("registrationStep==='payment'かつ契約が無ければpaymentバナー(従来どおり)", () => {
    expect(resolveRegistrationBannerKind("payment", false)).toBe("payment");
  });

  it("2026-09-24: registrationStep==='payment'でもhasActiveSubscription===trueならバナーを出さない(Pilot/永久無料の誤ったCTA抑制)", () => {
    expect(resolveRegistrationBannerKind("payment", true)).toBe("none");
  });

  it("registrationStep==='consent'は契約有無に関わらずconsentバナー", () => {
    expect(resolveRegistrationBannerKind("consent", true)).toBe("consent");
    expect(resolveRegistrationBannerKind("consent", false)).toBe("consent");
  });

  it("sms/profile/completed等は何も出さない", () => {
    expect(resolveRegistrationBannerKind("sms", false)).toBe("none");
    expect(resolveRegistrationBannerKind("profile", false)).toBe("none");
    expect(resolveRegistrationBannerKind("completed", true)).toBe("none");
  });
});
