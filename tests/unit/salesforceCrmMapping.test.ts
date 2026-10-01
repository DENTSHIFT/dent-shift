import { describe, expect, it } from "vitest";
import {
  DEFAULT_OPPORTUNITY_STAGES,
  buildClinicSummaryFields,
  buildConsultationFields,
  buildContactFields,
  buildDiagnosisFields,
  buildLeadFields,
  buildOpportunityFields,
  normalizeSiteDomain,
  resolveOpportunityStageMap,
  opportunityOutcome,
  summarizeAiExposure,
  type ClinicSnapshot,
  type ConsultationSnapshot,
  type DiagnosisSnapshot,
  type SubscriptionSnapshot,
} from "@/domain/integration/salesforceCrmMapping";

const CLINIC: ClinicSnapshot = {
  id: "clinic_1",
  name: "テスト歯科",
  directorName: null,
  url: "https://WWW.Example-Dental.jp/path",
  contactEmail: "info@example-dental.jp",
  contactPhone: null,
  utmSource: null,
  utmMedium: null,
  utmCampaign: null,
  utmContent: null,
  utmTerm: null,
  diagnosisCount: 1,
  latestDiagnosis: { id: "diag_1", measuredAt: new Date("2026-10-01T00:00:00Z") },
  firstContactCreatedAt: null,
};

function subscription(overrides: Partial<SubscriptionSnapshot> = {}): SubscriptionSnapshot {
  return {
    id: "sub_1",
    plan: "premium",
    status: "active",
    createdAt: new Date("2026-10-01T00:00:00Z"),
    trialStartedAt: null,
    trialEndsAt: null,
    currentPeriodEnd: new Date("2026-11-01T00:00:00Z"),
    cancelAtPeriodEnd: false,
    cancelAt: null,
    canceledAt: null,
    endedAt: null,
    billingExempt: false,
    firstActivatedAt: new Date("2026-10-08T00:00:00Z"),
    ...overrides,
  };
}

describe("buildLeadFields", () => {
  it("院長名が無ければ医院名を姓にし、UTMが無ければUTM項目を送らない(流入元を推測しない)", () => {
    const fields = buildLeadFields({
      clinic: CLINIC,
      eventType: "diagnosis_completed",
      primaryContact: null,
      primarySubscription: null,
      appBaseUrl: "https://dentshift.jp/",
    });
    expect(fields.LastName).toBe("テスト歯科");
    expect(fields.DentShift_Diagnosis_Url__c).toBe("https://dentshift.jp/diagnosis/result/diag_1");
    expect(Object.keys(fields).some((k) => k.includes("UTM"))).toBe(false);
    expect(fields).not.toHaveProperty("Phone");
  });

  it("APP_BASE_URLが無ければ診断結果リンクを送らない", () => {
    const fields = buildLeadFields({
      clinic: CLINIC,
      eventType: "diagnosis_completed",
      primaryContact: null,
      primarySubscription: null,
      appBaseUrl: null,
    });
    expect(fields).not.toHaveProperty("DentShift_Diagnosis_Url__c");
  });
});

describe("normalizeSiteDomain", () => {
  it("小文字化しwww.を除いたホスト名を返し、不正URLはnull", () => {
    expect(normalizeSiteDomain("https://WWW.Example-Dental.jp/path")).toBe("example-dental.jp");
    expect(normalizeSiteDomain("not a url")).toBeNull();
  });
});

describe("buildContactFields", () => {
  it("医院のAccountへ外部IDで紐づけ、院長名が無ければ医院名を姓にする", () => {
    const fields = buildContactFields({
      clinic: CLINIC,
      contact: {
        id: "user_1",
        email: "owner@example-dental.jp",
        phoneNumber: null,
        role: "owner",
        registrationStep: "sms",
        emailVerifiedAt: null,
        phoneVerifiedAt: null,
        consentAcceptedAt: null,
      },
    });
    expect(fields).toEqual(
      expect.objectContaining({
        LastName: "テスト歯科",
        Account: { DentShift_Clinic_Id__c: "clinic_1" },
        DentShift_Registration_Step__c: "sms",
      })
    );
  });
});

describe("buildOpportunityFields", () => {
  it("有料契約は受注フェーズ・次回更新日を設定する", () => {
    const fields = buildOpportunityFields({ clinic: CLINIC, subscription: subscription(), stages: DEFAULT_OPPORTUNITY_STAGES });
    expect(fields).toEqual(
      expect.objectContaining({
        Name: "テスト歯科 - DENT SHIFT プレミアムプラン",
        StageName: "Closed Won",
        DentShift_Next_Renewal_Date__c: "2026-11-01",
      })
    );
  });

  it("有料化しないまま解約した契約(トライアル中の解約)は失注にし、終了日を設定する", () => {
    const fields = buildOpportunityFields({
      clinic: CLINIC,
      subscription: subscription({ status: "cancelled", firstActivatedAt: null, endedAt: new Date("2026-10-20T00:00:00Z") }),
      stages: DEFAULT_OPPORTUNITY_STAGES,
    });
    expect(fields.StageName).toBe("Closed Lost");
    expect(fields.CloseDate).toBe("2026-10-20");
    expect(fields.DentShift_Ended_At__c).toBe("2026-10-20T00:00:00.000Z");
    expect(fields).not.toHaveProperty("DentShift_Next_Renewal_Date__c");
  });

  it("有料契約後に解約しても受注(Closed Won)のまま維持し、解約は契約項目で表す", () => {
    const fields = buildOpportunityFields({
      clinic: CLINIC,
      subscription: subscription({
        status: "cancelled",
        canceledAt: new Date("2026-12-01T00:00:00Z"),
        endedAt: new Date("2026-12-31T00:00:00Z"),
      }),
      stages: DEFAULT_OPPORTUNITY_STAGES,
    });
    expect(fields.StageName).toBe("Closed Won");
    expect(fields.CloseDate).toBe("2026-10-08"); // 受注日=初回有料化日
    expect(fields.DentShift_Billing_Status__c).toBe("cancelled");
    expect(fields.DentShift_Cancel_Requested_At__c).toBe("2026-12-01T00:00:00.000Z");
    expect(fields.DentShift_Ended_At__c).toBe("2026-12-31T00:00:00.000Z");
    expect(fields.DentShift_Paid_Started_At__c).toBe("2026-10-08T00:00:00.000Z");
  });

  it.each(["past_due", "suspended", "restricted"])("有料契約後の%sでも受注のまま", (status) => {
    expect(opportunityOutcome(subscription({ status }))).toBe("won");
  });

  it("トライアル中は進行中(組織に存在するQualification)", () => {
    const fields = buildOpportunityFields({
      clinic: CLINIC,
      subscription: subscription({ status: "trial", firstActivatedAt: null, trialEndsAt: new Date("2026-10-15T00:00:00Z") }),
      stages: DEFAULT_OPPORTUNITY_STAGES,
    });
    expect(fields.StageName).toBe("Qualification");
    expect(fields.CloseDate).toBe("2026-10-15");
  });

  it("課金免除・Pilotの契約は有料化扱いにしない(受注に数えない)", () => {
    expect(opportunityOutcome(subscription({ billingExempt: true }))).toBe("open");
    const pilot = subscription({ externalSubscriptionId: "pilot_abc" });
    expect(opportunityOutcome(pilot)).toBe("open");
    expect(buildOpportunityFields({ clinic: CLINIC, subscription: pilot, stages: DEFAULT_OPPORTUNITY_STAGES }).DentShift_Pilot__c).toBe(true);
  });

  it("解約予約(期間末で解約)をそのまま反映する", () => {
    const fields = buildOpportunityFields({
      clinic: CLINIC,
      subscription: subscription({ cancelAtPeriodEnd: true, cancelAt: new Date("2026-11-01T00:00:00Z") }),
      stages: DEFAULT_OPPORTUNITY_STAGES,
    });
    expect(fields.DentShift_Cancel_At_Period_End__c).toBe(true);
    expect(fields.DentShift_Cancel_At__c).toBe("2026-11-01T00:00:00.000Z");
  });

  it("カード情報に相当する項目を一切含まない(支払方法は登録状態のみ)", () => {
    const fields = buildOpportunityFields({
      clinic: CLINIC,
      subscription: subscription({ paymentMethodStatus: "completed" }),
      stages: DEFAULT_OPPORTUNITY_STAGES,
    });
    expect(JSON.stringify(fields)).not.toMatch(/card|cvc|last4|brand|exp_month/i);
    expect(fields.DentShift_Payment_Method_Status__c).toBe("completed");
  });
});

describe("resolveOpportunityStageMap", () => {
  it("組織の選択リストに合わせて環境変数で上書きでき、未設定は既定値", () => {
    const stages = resolveOpportunityStageMap({ SALESFORCE_OPPORTUNITY_STAGE_OPEN: "Needs Analysis" });
    expect(stages).toEqual({ open: "Needs Analysis", won: "Closed Won", lost: "Closed Lost" });
  });
});

const DIAGNOSIS: DiagnosisSnapshot = {
  id: "diag_1",
  measuredAt: new Date("2026-10-01T00:00:00Z"),
  targetUrl: "https://www.example-dental.jp/",
  totalPoints: 42,
  totalStatus: "要改善",
  isSample: false,
  improvementTitles: ["Web予約導線", "Googleビジネスプロフィール", "症例ページ", "4件目は送らない"],
  aiObservations: [
    { provider: "openai", mention: false, measurementStatus: "measured" },
    { provider: "openai", mention: true, measurementStatus: "measured" },
    { provider: "gemini", mention: null, measurementStatus: "unavailable" },
  ],
};

describe("buildDiagnosisFields / summarizeAiExposure", () => {
  it("診断IDを外部IDとして要約(スコア・暫定・AI露出・改善上位3件・結果ページ)を送る", () => {
    const fields = buildDiagnosisFields({ clinicId: "clinic_1", diagnosis: DIAGNOSIS, linkAccount: true, appBaseUrl: "https://dentshift.jp" });
    expect(fields).toEqual(
      expect.objectContaining({
        DentShift_Clinic_Id__c: "clinic_1",
        DentShift_Account__r: { DentShift_Clinic_Id__c: "clinic_1" },
        DentShift_Total_Score__c: 42,
        DentShift_Provisional__c: false,
        DentShift_Improvement_Summary__c: "Web予約導線\nGoogleビジネスプロフィール\n症例ページ",
        DentShift_Result_Url__c: "https://dentshift.jp/diagnosis/result/diag_1",
      })
    );
  });

  it("取引先が無い医院(診断のみ)は取引先へ紐づけない", () => {
    const fields = buildDiagnosisFields({ clinicId: "clinic_1", diagnosis: DIAGNOSIS, linkAccount: false, appBaseUrl: null });
    expect(fields).not.toHaveProperty("DentShift_Account__r");
    expect(fields).not.toHaveProperty("DentShift_Result_Url__c");
  });

  it("計測できなかった観測を「言及なし」に数えない", () => {
    expect(summarizeAiExposure(DIAGNOSIS.aiObservations)).toBe("openai: 言及あり 1/2 / gemini: 計測不可");
    expect(summarizeAiExposure([])).toBeNull();
  });
});

function consultation(overrides: Partial<ConsultationSnapshot> = {}): ConsultationSnapshot {
  return {
    timerexEventId: "tx_1",
    status: "confirmed",
    contactId: null,
    matchMethod: "signed_ref",
    startAt: new Date("2026-10-10T01:00:00Z"),
    endAt: new Date("2026-10-10T01:45:00Z"),
    bookedAt: new Date("2026-10-02T00:00:00Z"),
    canceledAt: null,
    calendarName: "45分相談",
    hostName: "担当A",
    ...overrides,
  };
}

describe("buildConsultationFields", () => {
  it("TimeRexの予約ID単位で予約状態を送り、実施結果(担当者入力)は送らない", () => {
    const fields = buildConsultationFields({ clinicId: "clinic_1", consultation: consultation({ contactId: "user_1" }), linkAccount: true });
    expect(fields).toEqual(
      expect.objectContaining({
        DentShift_Booking_Status__c: "予約成立",
        DentShift_Start_At__c: "2026-10-10T01:00:00.000Z",
        DentShift_Contact__r: { DentShift_User_Id__c: "user_1" },
        DentShift_Account__r: { DentShift_Clinic_Id__c: "clinic_1" },
      })
    );
    expect(fields).not.toHaveProperty("DentShift_Attendance__c");
  });

  it("キャンセルはキャンセル日時とともに記録する", () => {
    const fields = buildConsultationFields({
      clinicId: "clinic_1",
      consultation: consultation({ status: "cancelled", canceledAt: new Date("2026-10-05T00:00:00Z") }),
      linkAccount: false,
    });
    expect(fields.DentShift_Booking_Status__c).toBe("キャンセル");
    expect(fields.DentShift_Canceled_At__c).toBe("2026-10-05T00:00:00.000Z");
    expect(fields).not.toHaveProperty("DentShift_Account__r");
  });
});

describe("buildClinicSummaryFields", () => {
  const now = new Date("2026-10-06T00:00:00Z");

  it("相談CTAクリック・トライアル申込・次回相談予約を、記録された事実だけで要約する", () => {
    const fields = buildClinicSummaryFields({
      latestDiagnosis: DIAGNOSIS,
      activity: {
        consultationCtaLastClickedAt: new Date("2026-10-01T02:00:00Z"),
        consultationCtaClickCount: 2,
        trialSignupStartedAt: null,
      },
      consultations: [consultation()],
      now,
    });
    expect(fields).toEqual(
      expect.objectContaining({
        DentShift_Latest_Score__c: 42,
        DentShift_Consultation_Cta_Clicked_At__c: "2026-10-01T02:00:00.000Z",
        DentShift_Consultation_Cta_Clicks__c: 2,
        DentShift_Consultation_Status__c: "予約成立",
        DentShift_Next_Consultation_At__c: "2026-10-10T01:00:00.000Z",
      })
    );
    expect(fields).not.toHaveProperty("DentShift_Trial_Signup_Started_At__c");
  });

  it("予約がキャンセルされたら次回相談予定を空に戻す", () => {
    const fields = buildClinicSummaryFields({
      latestDiagnosis: null,
      activity: null,
      consultations: [consultation({ status: "cancelled" })],
      now,
    });
    expect(fields.DentShift_Consultation_Status__c).toBe("キャンセル");
    expect(fields).toHaveProperty("DentShift_Next_Consultation_At__c", null);
  });

  it("相談予約が一度も無い医院では相談項目を送らない", () => {
    const fields = buildClinicSummaryFields({ latestDiagnosis: null, activity: null, consultations: [], now });
    expect(fields).toEqual({});
  });
});
