import { describe, expect, it } from "vitest";
import { applyAuthenticatedDiagnosisProfile } from "@/app/diagnosis/diagnosisPrefill";

const profile = {
  authenticated: true as const,
  clinicName: "登録済み歯科医院",
  clinicUrl: "https://registered.example.com",
  contactEmail: "registered@example.com",
  contactPhone: "03-1234-5678",
  gbpUrl: "https://g.page/registered",
  bookingUrl: "https://registered.example.com/book",
};

describe("applyAuthenticatedDiagnosisProfile", () => {
  it("登録済みの医院名・公式URL・メールを正本として自動入力する", () => {
    expect(
      applyAuthenticatedDiagnosisProfile(
        {
          clinicName: "途中入力",
          clinicUrl: "https://other.example.com",
          contactEmail: "other@example.com",
          contactPhone: "090-1111-2222",
          gbpUrl: "",
          bookingUrl: "",
        },
        profile
      )
    ).toEqual({
      clinicName: "登録済み歯科医院",
      clinicUrl: "https://registered.example.com",
      contactEmail: "registered@example.com",
      contactPhone: "03-1234-5678",
      gbpUrl: "https://g.page/registered",
      bookingUrl: "https://registered.example.com/book",
    });
  });

  it("任意URLを利用者が入力済みなら、その値は上書きしない", () => {
    const result = applyAuthenticatedDiagnosisProfile(
      {
        clinicName: "",
        clinicUrl: "",
        contactEmail: "",
        contactPhone: "",
        gbpUrl: "https://custom.example.com/gbp",
        bookingUrl: "https://custom.example.com/book",
      },
      profile
    );

    expect(result.gbpUrl).toBe("https://custom.example.com/gbp");
    expect(result.bookingUrl).toBe("https://custom.example.com/book");
  });

  it("登録済みの電話番号がない場合は、利用者の入力値を保持する", () => {
    const result = applyAuthenticatedDiagnosisProfile(
      {
        clinicName: "",
        clinicUrl: "",
        contactEmail: "",
        contactPhone: "090-1111-2222",
        gbpUrl: "",
        bookingUrl: "",
      },
      { ...profile, contactPhone: null }
    );

    expect(result.contactPhone).toBe("090-1111-2222");
  });
});
