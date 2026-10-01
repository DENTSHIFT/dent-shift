// DENT SHIFTのDB状態をSalesforceのLead/Account/Contact/Opportunityと、カスタムオブジェクト
// (DentShift_Diagnosis__c=診断履歴、DentShift_Consultation__c=TimeRex相談予約)へ
// 写像する純粋関数群。外部IDはアプリのID(医院ID・ユーザーID・契約ID・診断ID)とTimeRexの予約IDのみを使い、
// メールアドレスでは医院を統合しない。カード情報・認証情報・OTPは入力に含めない。
//
// 項目API名はこのファイルだけで定義する(Salesforce組織側へ同名の項目を作成する前提)。
// 既存項目(Event_Type__c / Registration_Step__c / Trial_Ends_At__c)はそのまま継続利用する。

export const SF_LEAD_SOURCE = "DENT SHIFT 無料AI診断";

// Lead(診断のみの医院)とAccount(会員登録済みの医院)の両方に持たせる、医院単位の要約項目。
function summaryFieldNames() {
  return {
    latestScore: "DentShift_Latest_Score__c",
    latestStatus: "DentShift_Latest_Status__c",
    latestProvisional: "DentShift_Latest_Provisional__c",
    ctaClickedAt: "DentShift_Consultation_Cta_Clicked_At__c",
    ctaClickCount: "DentShift_Consultation_Cta_Clicks__c",
    trialSignupStartedAt: "DentShift_Trial_Signup_Started_At__c",
    consultationStatus: "DentShift_Consultation_Status__c",
    nextConsultationAt: "DentShift_Next_Consultation_At__c",
  } as const;
}

export const SF_FIELDS = {
  lead: {
    externalId: "DentShift_Clinic_Id__c",
    lastDiagnosedAt: "DentShift_Last_Diagnosed_At__c",
    diagnosisCount: "DentShift_Diagnosis_Count__c",
    diagnosisUrl: "DentShift_Diagnosis_Url__c",
    siteDomain: "DentShift_Site_Domain__c",
    utmSource: "DentShift_UTM_Source__c",
    utmMedium: "DentShift_UTM_Medium__c",
    utmCampaign: "DentShift_UTM_Campaign__c",
    utmContent: "DentShift_UTM_Content__c",
    utmTerm: "DentShift_UTM_Term__c",
    signedUpAt: "DentShift_Signed_Up_At__c",
    eventType: "Event_Type__c",
    registrationStep: "Registration_Step__c",
    trialEndsAt: "Trial_Ends_At__c",
    ...summaryFieldNames(),
  },
  account: {
    externalId: "DentShift_Clinic_Id__c",
    siteDomain: "DentShift_Site_Domain__c",
    signedUpAt: "DentShift_Signed_Up_At__c",
    currentPlan: "DentShift_Current_Plan__c",
    contractStatus: "DentShift_Contract_Status__c",
    opsUrl: "DentShift_Ops_Url__c",
    ...summaryFieldNames(),
  },
  contact: {
    externalId: "DentShift_User_Id__c",
    role: "DentShift_Role__c",
    registrationStep: "DentShift_Registration_Step__c",
    emailVerifiedAt: "DentShift_Email_Verified_At__c",
    phoneVerifiedAt: "DentShift_Phone_Verified_At__c",
    consentAcceptedAt: "DentShift_Consent_Accepted_At__c",
    smsVerificationExempt: "DentShift_SMS_Verification_Exempt__c",
    signedUpAt: "DentShift_Signed_Up_At__c",
  },
  opportunity: {
    externalId: "DentShift_Subscription_Id__c",
    plan: "DentShift_Plan__c",
    billingStatus: "DentShift_Billing_Status__c",
    trialStartedAt: "DentShift_Trial_Started_At__c",
    trialEndsAt: "DentShift_Trial_Ends_At__c",
    nextRenewalDate: "DentShift_Next_Renewal_Date__c",
    cancelAtPeriodEnd: "DentShift_Cancel_At_Period_End__c",
    cancelAt: "DentShift_Cancel_At__c",
    endedAt: "DentShift_Ended_At__c",
    billingExempt: "DentShift_Billing_Exempt__c",
    pilot: "DentShift_Pilot__c",
    paymentMethodStatus: "DentShift_Payment_Method_Status__c",
    firstActivatedAt: "DentShift_Paid_Started_At__c",
    canceledAt: "DentShift_Cancel_Requested_At__c",
  },
  diagnosis: {
    sobject: "DentShift_Diagnosis__c",
    externalId: "DentShift_Diagnosis_Id__c",
    clinicId: "DentShift_Clinic_Id__c",
    account: "DentShift_Account__c",
    measuredAt: "DentShift_Measured_At__c",
    targetUrl: "DentShift_Target_Url__c",
    totalScore: "DentShift_Total_Score__c",
    totalStatus: "DentShift_Total_Status__c",
    provisional: "DentShift_Provisional__c",
    aiExposure: "DentShift_AI_Exposure__c",
    improvementSummary: "DentShift_Improvement_Summary__c",
    resultUrl: "DentShift_Result_Url__c",
  },
  consultation: {
    sobject: "DentShift_Consultation__c",
    externalId: "DentShift_TimeRex_Event_Id__c",
    clinicId: "DentShift_Clinic_Id__c",
    account: "DentShift_Account__c",
    contact: "DentShift_Contact__c",
    bookingStatus: "DentShift_Booking_Status__c",
    startAt: "DentShift_Start_At__c",
    endAt: "DentShift_End_At__c",
    bookedAt: "DentShift_Booked_At__c",
    canceledAt: "DentShift_Canceled_At__c",
    hostName: "DentShift_Host_Name__c",
    calendarName: "DentShift_Calendar_Name__c",
    matchMethod: "DentShift_Match_Method__c",
    // 相談の実施有無(DentShift_Attendance__c)はSalesforce担当者が入力する項目で、同期では書き込まない。
  },
} as const;

export interface ClinicSnapshot {
  id: string;
  name: string;
  directorName: string | null;
  url: string;
  contactEmail: string | null;
  contactPhone: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  diagnosisCount: number;
  latestDiagnosis: { id: string; measuredAt: Date } | null;
  firstContactCreatedAt: Date | null;
  activity?: ClinicActivitySnapshot;
}

/** IntegrationEvent(アプリが実際に記録した操作)から集計した医院単位の行動。推測値は含めない。 */
export interface ClinicActivitySnapshot {
  consultationCtaLastClickedAt: Date | null;
  consultationCtaClickCount: number;
  trialSignupStartedAt: Date | null;
}

export interface DiagnosisSnapshot {
  id: string;
  measuredAt: Date;
  targetUrl: string;
  totalPoints: number;
  totalStatus: string;
  isSample: boolean;
  improvementTitles: string[];
  aiObservations: { provider: string; mention: boolean | null; measurementStatus: string }[];
}

export interface ConsultationSnapshot {
  timerexEventId: string;
  status: string;
  contactId: string | null;
  matchMethod: string;
  startAt: Date;
  endAt: Date;
  bookedAt: Date | null;
  canceledAt: Date | null;
  calendarName: string | null;
  hostName: string | null;
}

export interface ContactSnapshot {
  id: string;
  email: string;
  phoneNumber: string | null;
  role: string;
  registrationStep: string | null;
  emailVerifiedAt: Date | null;
  phoneVerifiedAt: Date | null;
  consentAcceptedAt: Date | null;
  smsVerificationExempt?: boolean;
  createdAt?: Date;
}

export interface SubscriptionSnapshot {
  id: string;
  plan: string;
  status: string;
  createdAt: Date;
  trialStartedAt: Date | null;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  cancelAt: Date | null;
  canceledAt: Date | null;
  endedAt: Date | null;
  billingExempt: boolean;
  /** Stripeの確定通知で初めてactive(有料)になった時刻。一度でも有料化した契約の受注根拠。 */
  firstActivatedAt: Date | null;
  paymentMethodStatus?: string | null;
  externalSubscriptionId?: string | null;
}

// 商談フェーズは「進行中/受注/失注」の3区分だけをSalesforceへ写す。契約の細かな状態
// (支払遅延・停止・解約予約・解約済み)はDentShift_Billing_Status__c等の契約項目で管理し、
// フェーズは動かさない。値はSalesforce組織の選択リスト値に合わせて環境変数で上書きできる。
export interface OpportunityStageMap {
  open: string;
  won: string;
  lost: string;
}

// 既定値は接続先組織の商談フェーズ選択リスト(読み取りで確認済み)に存在する値。
export const DEFAULT_OPPORTUNITY_STAGES: OpportunityStageMap = {
  open: "Qualification",
  won: "Closed Won",
  lost: "Closed Lost",
};

export type OpportunityOutcome = keyof OpportunityStageMap;

/**
 * 受注(won): 一度でもStripeで有料(active)になった契約。その後に支払遅延・停止・解約になっても
 *   受注実績は取り消さない(解約は契約項目で管理する)。Pilot・永久無料(billingExempt)は受注に数えない。
 * 失注(lost): 有料化しないまま解約(トライアル中の解約・トライアル終了で未払い)した契約。
 * 進行中(open): それ以外(トライアル中など)。
 */
export function opportunityOutcome(subscription: SubscriptionSnapshot): OpportunityOutcome {
  if (subscription.firstActivatedAt && !subscription.billingExempt && !isPilotSubscription(subscription)) return "won";
  if (subscription.status === "cancelled") return "lost";
  return "open";
}

const PLAN_LABELS: Record<string, string> = {
  light: "ライトプラン",
  standard: "スタンダードプラン",
  premium: "プレミアムプラン",
};

export function planLabel(plan: string): string {
  return PLAN_LABELS[plan] ?? plan;
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/**
 * 医院URLから比較用のドメイン(先頭の"www."を除く小文字ホスト名)を取り出す。
 * 未ログインでの再診断は別の医院IDになるため、自動統合はせず、Salesforce側の重複ルールや
 * レポートで「同じサイトの診断」を見つけるための参考値としてだけ使う。
 */
export function normalizeSiteDomain(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

// 明示的に空へ戻したい項目に使う(例: 次回相談予定が無くなった)。送信時はnullになる。
const CLEAR = Symbol("clear");

// 値がnullの項目は送らない(既存のSalesforce上の値を空で上書きしないため)。CLEARだけはnullで送る。
function withoutNulls(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields)
      .filter(([, value]) => value !== null && value !== undefined)
      .map(([key, value]) => [key, value === CLEAR ? null : value])
  );
}

const CONSULTATION_STATUS_LABELS: Record<string, string> = {
  confirmed: "予約成立",
  cancelled: "キャンセル",
};

/**
 * 医院単位の要約(最新診断・相談CTA・トライアル申込・相談予約)。LeadとAccountの両方へ同じ値を送る。
 * 相談の「実施」はTimeRexから取得できないため、ここでは予約状態(成立/キャンセル)だけを扱う。
 */
export function buildClinicSummaryFields(input: {
  latestDiagnosis: DiagnosisSnapshot | null;
  activity: ClinicActivitySnapshot | null;
  consultations: ConsultationSnapshot[];
  now: Date;
}): Record<string, unknown> {
  const f = summaryFieldNames();
  const latestBooking = [...input.consultations].sort(
    (a, b) => (b.bookedAt ?? b.startAt).getTime() - (a.bookedAt ?? a.startAt).getTime()
  )[0];
  const nextBooking = input.consultations
    .filter((c) => c.status === "confirmed" && c.startAt.getTime() >= input.now.getTime())
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())[0];
  return withoutNulls({
    [f.latestScore]: input.latestDiagnosis?.totalPoints ?? null,
    [f.latestStatus]: input.latestDiagnosis?.totalStatus ?? null,
    [f.latestProvisional]: input.latestDiagnosis ? input.latestDiagnosis.isSample : null,
    [f.ctaClickedAt]: iso(input.activity?.consultationCtaLastClickedAt ?? null),
    [f.ctaClickCount]: input.activity ? input.activity.consultationCtaClickCount : null,
    [f.trialSignupStartedAt]: iso(input.activity?.trialSignupStartedAt ?? null),
    [f.consultationStatus]: latestBooking ? CONSULTATION_STATUS_LABELS[latestBooking.status] ?? latestBooking.status : null,
    // 今後の予約が無くなった(キャンセル・日時経過)場合は空にする(古い予定を残さない)。
    [f.nextConsultationAt]: input.consultations.length > 0 ? iso(nextBooking?.startAt ?? null) ?? CLEAR : null,
  });
}

/** AI別の言及状況の要約(例: "openai: 言及なし 0/3")。計測できなかった観測は言及なしに数えない。 */
export function summarizeAiExposure(observations: DiagnosisSnapshot["aiObservations"]): string | null {
  if (observations.length === 0) return null;
  const byProvider = new Map<string, { measured: number; mentioned: number; unavailable: number }>();
  for (const o of observations) {
    const row = byProvider.get(o.provider) ?? { measured: 0, mentioned: 0, unavailable: 0 };
    if (o.measurementStatus === "unavailable" || o.mention === null) row.unavailable += 1;
    else {
      row.measured += 1;
      if (o.mention) row.mentioned += 1;
    }
    byProvider.set(o.provider, row);
  }
  return [...byProvider.entries()]
    .map(([provider, r]) =>
      r.measured === 0
        ? `${provider}: 計測不可`
        : `${provider}: 言及${r.mentioned > 0 ? "あり" : "なし"} ${r.mentioned}/${r.measured}${r.unavailable ? `(計測不可${r.unavailable})` : ""}`
    )
    .join(" / ");
}

export function diagnosisResultUrl(appBaseUrl: string | null, diagnosisId: string): string | null {
  return appBaseUrl ? `${appBaseUrl.replace(/\/$/, "")}/diagnosis/result/${diagnosisId}` : null;
}

export function buildDiagnosisFields(input: {
  clinicId: string;
  diagnosis: DiagnosisSnapshot;
  linkAccount: boolean;
  appBaseUrl: string | null;
}): Record<string, unknown> {
  const { diagnosis } = input;
  const f = SF_FIELDS.diagnosis;
  return withoutNulls({
    Name: truncate(`診断 ${dateOnly(diagnosis.measuredAt)}`, 80),
    [f.clinicId]: input.clinicId,
    // 取引先(会員登録済みの医院)がある場合だけ紐づける。診断のみの医院はLeadの要約項目で確認する。
    [`${f.account.replace(/__c$/, "__r")}`]: input.linkAccount
      ? { [SF_FIELDS.account.externalId]: input.clinicId }
      : null,
    [f.measuredAt]: iso(diagnosis.measuredAt),
    [f.targetUrl]: truncate(diagnosis.targetUrl, 255),
    [f.totalScore]: diagnosis.totalPoints,
    [f.totalStatus]: diagnosis.totalStatus,
    [f.provisional]: diagnosis.isSample,
    [f.aiExposure]: summarizeAiExposure(diagnosis.aiObservations),
    [f.improvementSummary]: diagnosis.improvementTitles.length
      ? truncate(diagnosis.improvementTitles.slice(0, 3).join("\n"), 1000)
      : null,
    [f.resultUrl]: diagnosisResultUrl(input.appBaseUrl, diagnosis.id),
  });
}

export function buildConsultationFields(input: {
  clinicId: string;
  consultation: ConsultationSnapshot;
  linkAccount: boolean;
}): Record<string, unknown> {
  const { consultation } = input;
  const f = SF_FIELDS.consultation;
  const rel = (field: string) => field.replace(/__c$/, "__r");
  return withoutNulls({
    Name: truncate(`相談予約 ${consultation.startAt.toISOString().slice(0, 16).replace("T", " ")} UTC`, 80),
    [f.clinicId]: input.clinicId,
    [rel(f.account)]: input.linkAccount ? { [SF_FIELDS.account.externalId]: input.clinicId } : null,
    [rel(f.contact)]: consultation.contactId ? { [SF_FIELDS.contact.externalId]: consultation.contactId } : null,
    [f.bookingStatus]: CONSULTATION_STATUS_LABELS[consultation.status] ?? consultation.status,
    [f.startAt]: iso(consultation.startAt),
    [f.endAt]: iso(consultation.endAt),
    [f.bookedAt]: iso(consultation.bookedAt),
    [f.canceledAt]: iso(consultation.canceledAt),
    [f.hostName]: consultation.hostName ? truncate(consultation.hostName, 80) : null,
    [f.calendarName]: consultation.calendarName ? truncate(consultation.calendarName, 80) : null,
    [f.matchMethod]: consultation.matchMethod,
  });
}

export function buildLeadFields(input: {
  clinic: ClinicSnapshot;
  eventType: string;
  primaryContact: ContactSnapshot | null;
  primarySubscription: SubscriptionSnapshot | null;
  appBaseUrl: string | null;
  summary?: Record<string, unknown>;
}): Record<string, unknown> {
  const { clinic } = input;
  const f = SF_FIELDS.lead;
  const diagnosisUrl = clinic.latestDiagnosis ? diagnosisResultUrl(input.appBaseUrl, clinic.latestDiagnosis.id) : null;
  return withoutNulls({
    ...input.summary,
    Company: truncate(clinic.name, 255),
    LastName: truncate(clinic.directorName?.trim() || clinic.name, 80),
    Email: clinic.contactEmail,
    Phone: clinic.contactPhone,
    Website: clinic.url,
    LeadSource: SF_LEAD_SOURCE,
    [f.eventType]: input.eventType,
    [f.lastDiagnosedAt]: iso(clinic.latestDiagnosis?.measuredAt ?? null),
    [f.diagnosisCount]: clinic.diagnosisCount,
    [f.diagnosisUrl]: diagnosisUrl,
    [f.siteDomain]: normalizeSiteDomain(clinic.url),
    // 流入元はアプリが実際に受け取ったUTM(初回流入)だけを記録し、推測で補わない。
    [f.utmSource]: clinic.utmSource,
    [f.utmMedium]: clinic.utmMedium,
    [f.utmCampaign]: clinic.utmCampaign,
    [f.utmContent]: clinic.utmContent,
    [f.utmTerm]: clinic.utmTerm,
    [f.signedUpAt]: iso(clinic.firstContactCreatedAt),
    [f.registrationStep]: input.primaryContact?.registrationStep ?? null,
    [f.trialEndsAt]: iso(input.primarySubscription?.trialEndsAt ?? null),
  });
}

const PILOT_EXTERNAL_ID_PREFIX = "pilot_";

export function isPilotSubscription(subscription: SubscriptionSnapshot): boolean {
  return Boolean(subscription.externalSubscriptionId?.startsWith(PILOT_EXTERNAL_ID_PREFIX));
}

export function buildAccountFields(
  clinic: ClinicSnapshot,
  extra: { summary?: Record<string, unknown>; latestSubscription?: SubscriptionSnapshot | null; appBaseUrl?: string | null } = {}
): Record<string, unknown> {
  const f = SF_FIELDS.account;
  return withoutNulls({
    ...extra.summary,
    [f.currentPlan]: extra.latestSubscription ? extra.latestSubscription.plan : null,
    [f.contractStatus]: extra.latestSubscription ? extra.latestSubscription.status : null,
    [f.opsUrl]: extra.appBaseUrl
      ? `${extra.appBaseUrl.replace(/\/$/, "")}/ops/integration-events?clinicId=${encodeURIComponent(clinic.id)}`
      : null,
    Name: truncate(clinic.name, 255),
    Website: clinic.url,
    Phone: clinic.contactPhone,
    [f.siteDomain]: normalizeSiteDomain(clinic.url),
    [f.signedUpAt]: iso(clinic.firstContactCreatedAt),
  });
}

export function buildContactFields(input: {
  clinic: ClinicSnapshot;
  contact: ContactSnapshot;
}): Record<string, unknown> {
  const { clinic, contact } = input;
  const f = SF_FIELDS.contact;
  // ContactモデルはDENT SHIFT上で氏名を持たないため、院長(owner)は医院の院長名、
  // それ以外は医院名を姓として使う(Salesforceの必須項目LastNameを満たすため)。
  const lastName = contact.role === "owner" && clinic.directorName?.trim() ? clinic.directorName.trim() : clinic.name;
  return withoutNulls({
    LastName: truncate(lastName, 80),
    Email: contact.email,
    Phone: contact.phoneNumber,
    Account: { [SF_FIELDS.account.externalId]: clinic.id },
    [f.role]: contact.role,
    [f.registrationStep]: contact.registrationStep,
    [f.emailVerifiedAt]: iso(contact.emailVerifiedAt),
    [f.phoneVerifiedAt]: iso(contact.phoneVerifiedAt),
    [f.consentAcceptedAt]: iso(contact.consentAcceptedAt),
    [f.smsVerificationExempt]: contact.smsVerificationExempt ?? null,
    [f.signedUpAt]: iso(contact.createdAt ?? null),
  });
}

function opportunityCloseDate(subscription: SubscriptionSnapshot, outcome: OpportunityOutcome): Date {
  if (outcome === "won") return subscription.firstActivatedAt ?? subscription.createdAt;
  if (outcome === "lost") return subscription.endedAt ?? subscription.canceledAt ?? subscription.createdAt;
  return subscription.trialEndsAt ?? subscription.createdAt;
}

export function buildOpportunityFields(input: {
  clinic: ClinicSnapshot;
  subscription: SubscriptionSnapshot;
  stages: OpportunityStageMap;
}): Record<string, unknown> {
  const { clinic, subscription } = input;
  const f = SF_FIELDS.opportunity;
  const outcome = opportunityOutcome(subscription);
  return withoutNulls({
    Name: truncate(`${clinic.name} - DENT SHIFT ${planLabel(subscription.plan)}`, 120),
    Account: { [SF_FIELDS.account.externalId]: clinic.id },
    StageName: input.stages[outcome],
    CloseDate: dateOnly(opportunityCloseDate(subscription, outcome)),
    [f.plan]: subscription.plan,
    [f.billingStatus]: subscription.status,
    [f.trialStartedAt]: iso(subscription.trialStartedAt),
    [f.trialEndsAt]: iso(subscription.trialEndsAt),
    [f.nextRenewalDate]:
      subscription.currentPeriodEnd && subscription.status !== "cancelled"
        ? dateOnly(subscription.currentPeriodEnd)
        : null,
    [f.cancelAtPeriodEnd]: subscription.cancelAtPeriodEnd,
    [f.cancelAt]: iso(subscription.cancelAt),
    [f.endedAt]: iso(subscription.endedAt ?? (subscription.status === "cancelled" ? subscription.canceledAt : null)),
    [f.billingExempt]: subscription.billingExempt,
    [f.pilot]: isPilotSubscription(subscription),
    [f.paymentMethodStatus]: subscription.paymentMethodStatus ?? null,
    [f.firstActivatedAt]: iso(subscription.firstActivatedAt),
    // Stripeのcanceled_at=解約の申請(予約)が行われた時刻。
    [f.canceledAt]: iso(subscription.canceledAt),
  });
}

// TimeRexの相談予約は、Task(活動)ではなくカスタムオブジェクトDentShift_Consultation__cへ
// TimeRexの予約IDを外部IDとして記録する(活動には確実な外部IDによるupsertの手段が無いため)。
// 担当者の対応履歴・次回対応は、Salesforce標準の活動(ToDo・行動)で担当者が記録する(同期では作らない)。

export function resolveOpportunityStageMap(env: Record<string, string | undefined>): OpportunityStageMap {
  const pick = (key: keyof OpportunityStageMap) =>
    env[`SALESFORCE_OPPORTUNITY_STAGE_${key.toUpperCase()}`]?.trim() || DEFAULT_OPPORTUNITY_STAGES[key];
  return { open: pick("open"), won: pick("won"), lost: pick("lost") };
}
