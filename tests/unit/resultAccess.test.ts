import { describe, expect, it } from "vitest";
import { isDiagnosisResultAccessible } from "@/app/diagnosis/result/[id]/resultAccess";

describe("isDiagnosisResultAccessible", () => {
  it("会員登録前(匿名)の医院は誰でも閲覧できる", () => {
    expect(
      isDiagnosisResultAccessible({
        clinicHasAccount: false,
        contactClinicId: undefined,
        diagnosisClinicId: "clinic-1",
      })
    ).toBe(true);
  });

  it("会員登録前の医院は、ログイン中の別医院ユーザーでも閲覧できる", () => {
    expect(
      isDiagnosisResultAccessible({
        clinicHasAccount: false,
        contactClinicId: "clinic-2",
        diagnosisClinicId: "clinic-1",
      })
    ).toBe(true);
  });

  it("会員登録済みの医院は、未ログインでは閲覧できない", () => {
    expect(
      isDiagnosisResultAccessible({
        clinicHasAccount: true,
        contactClinicId: undefined,
        diagnosisClinicId: "clinic-1",
      })
    ).toBe(false);
  });

  it("会員登録済みの医院は、別医院のログインユーザーでは閲覧できない", () => {
    expect(
      isDiagnosisResultAccessible({
        clinicHasAccount: true,
        contactClinicId: "clinic-2",
        diagnosisClinicId: "clinic-1",
      })
    ).toBe(false);
  });

  it("会員登録済みの医院は、同一医院のログインユーザーなら閲覧できる", () => {
    expect(
      isDiagnosisResultAccessible({
        clinicHasAccount: true,
        contactClinicId: "clinic-1",
        diagnosisClinicId: "clinic-1",
      })
    ).toBe(true);
  });
});
