import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "@/server/db/prismaClient";
import {
  resolveSalesforceConfigFromProcessEnv,
  type SalesforceOAuthConfig,
} from "@/server/config/salesforceConfig";
import {
  isClinicSyncAllowed,
  resolveSalesforceSyncClinicAllowlistFromProcessEnv,
} from "@/server/config/salesforceSyncAllowlist";
import {
  DUPLICATES_DETECTED_ERROR_CODE,
  OAUTH_ERROR_CODE,
  ORG_MISMATCH_ERROR_CODE,
  SalesforceDeliveryError,
  getSalesforceRecordByExternalId,
  getSalesforceRecordById,
  updateSalesforceRecordById,
  upsertSalesforceRecordByExternalId,
} from "@/server/providers/salesforce/salesforceClient";
import {
  SF_FIELDS,
  buildAccountFields,
  buildClinicSummaryFields,
  buildConsultationFields,
  buildContactFields,
  buildDiagnosisFields,
  buildLeadFields,
  buildOpportunityFields,
  resolveOpportunityStageMap,
  type ClinicActivitySnapshot,
  type ClinicSnapshot,
  type ConsultationSnapshot,
  type ContactSnapshot,
  type DiagnosisSnapshot,
  type SubscriptionSnapshot,
} from "@/domain/integration/salesforceCrmMapping";
import { acquireCrmSyncLock, releaseCrmSyncLock, renewCrmSyncLock } from "@/server/db/crmSyncLockRepository";
import { notifySalesforceSyncFailure } from "@/server/services/notifySalesforceSyncFailure";

export const MAX_RETRY_COUNT = 8;
// 同じ医院の別の同期が実行中だった場合に、試行回数を消費せず再試行するまでの待ち時間。
export const LOCK_BUSY_RETRY_DELAY_MS = 30 * 1000;
// 診断履歴は同期のたびに直近の数件だけを送る(過去分は各診断の発生時の同期で作成済み)。
const DIAGNOSES_PER_SYNC = 3;

// 接続先組織の不一致・認証失敗時に、次に試すまでの待ち時間(定期実行の間隔と同じ)。
const CONNECTION_ERROR_RETRY_DELAY_MS = 15 * 60 * 1000;

class PermanentSyncError extends Error {}

export function isConnectionLevelError(error: unknown): boolean {
  return (
    error instanceof SalesforceDeliveryError &&
    (error.errorCode === ORG_MISMATCH_ERROR_CODE || error.errorCode === OAUTH_ERROR_CODE)
  );
}
class LockLostError extends Error {}

interface CrmSnapshot {
  clinic: ClinicSnapshot;
  contacts: ContactSnapshot[];
  subscriptions: SubscriptionSnapshot[];
  diagnoses: DiagnosisSnapshot[];
  consultations: ConsultationSnapshot[];
  activity: ClinicActivitySnapshot;
}

async function resolveClinicId(event: { clinicId: string | null; contactId: string | null }): Promise<string | null> {
  if (event.clinicId) return event.clinicId;
  if (!event.contactId) return null;
  const contact = await prisma.contact.findUnique({ where: { id: event.contactId }, select: { clinicId: true } });
  return contact?.clinicId ?? null;
}

function improvementTitles(json: string): string[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((task) => (task && typeof task === "object" ? (task as { title?: unknown }).title : null))
      .filter((title): title is string => typeof title === "string" && title.length > 0);
  } catch {
    return [];
  }
}

// Salesforceへ送るのは「イベント発生時の値」ではなく「同期時点のDBの確定状態」。
// 再送・順序の入れ替わり・Webhook再送があっても最終的に同じ内容へ収束する(冪等)。
async function loadCrmSnapshot(clinicId: string): Promise<CrmSnapshot | null> {
  const clinic = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: {
      id: true,
      name: true,
      directorName: true,
      url: true,
      contactEmail: true,
      contactPhone: true,
      utmSource: true,
      utmMedium: true,
      utmCampaign: true,
      utmContent: true,
      utmTerm: true,
      _count: { select: { diagnoses: true } },
      diagnoses: {
        orderBy: { measuredAt: "desc" },
        take: DIAGNOSES_PER_SYNC,
        select: {
          id: true,
          measuredAt: true,
          totalPoints: true,
          totalStatus: true,
          isSample: true,
          improvementTasksJson: true,
          aiObservations: { select: { provider: true, mention: true, measurementStatus: true } },
        },
      },
      contacts: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          email: true,
          phoneNumber: true,
          role: true,
          registrationStep: true,
          emailVerifiedAt: true,
          phoneVerifiedAt: true,
          consentAcceptedAt: true,
          smsVerificationExempt: true,
          createdAt: true,
        },
      },
      subscriptions: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          plan: true,
          status: true,
          createdAt: true,
          trialStartedAt: true,
          trialEndsAt: true,
          currentPeriodEnd: true,
          cancelAtPeriodEnd: true,
          cancelAt: true,
          canceledAt: true,
          endedAt: true,
          billingExempt: true,
          firstActivatedAt: true,
          paymentMethodStatus: true,
          externalSubscriptionId: true,
        },
      },
    },
  });
  if (!clinic) return null;

  const [ctaClicks, lastCtaClick, firstTrialSignup, consultations] = await Promise.all([
    prisma.integrationEvent.count({ where: { clinicId, eventType: "online_consultation_clicked" } }),
    prisma.integrationEvent.findFirst({
      where: { clinicId, eventType: "online_consultation_clicked" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    prisma.integrationEvent.findFirst({
      where: { clinicId, eventType: "trial_signup_started" },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
    prisma.consultationBooking.findMany({
      where: { clinicId },
      orderBy: { startAt: "asc" },
      select: {
        timerexEventId: true,
        status: true,
        contactId: true,
        matchMethod: true,
        startAt: true,
        endAt: true,
        bookedAt: true,
        canceledAt: true,
        calendarName: true,
        hostName: true,
      },
    }),
  ]);

  return {
    clinic: {
      id: clinic.id,
      name: clinic.name,
      directorName: clinic.directorName,
      url: clinic.url,
      contactEmail: clinic.contactEmail,
      contactPhone: clinic.contactPhone,
      utmSource: clinic.utmSource,
      utmMedium: clinic.utmMedium,
      utmCampaign: clinic.utmCampaign,
      utmContent: clinic.utmContent,
      utmTerm: clinic.utmTerm,
      diagnosisCount: clinic._count.diagnoses,
      latestDiagnosis: clinic.diagnoses[0] ? { id: clinic.diagnoses[0].id, measuredAt: clinic.diagnoses[0].measuredAt } : null,
      firstContactCreatedAt: clinic.contacts[0]?.createdAt ?? null,
    },
    contacts: clinic.contacts,
    subscriptions: clinic.subscriptions,
    diagnoses: clinic.diagnoses.map((d) => ({
      id: d.id,
      measuredAt: d.measuredAt,
      targetUrl: clinic.url,
      totalPoints: d.totalPoints,
      totalStatus: d.totalStatus,
      isSample: d.isSample,
      improvementTitles: improvementTitles(d.improvementTasksJson),
      aiObservations: d.aiObservations,
    })),
    consultations,
    activity: {
      consultationCtaLastClickedAt: lastCtaClick?.createdAt ?? null,
      consultationCtaClickCount: ctaClicks,
      trialSignupStartedAt: firstTrialSignup?.createdAt ?? null,
    },
  };
}

function primaryContactOf(contacts: ContactSnapshot[]): ContactSnapshot | null {
  return contacts.find((c) => c.role === "owner") ?? contacts[0] ?? null;
}

function latestSubscriptionOf(subscriptions: SubscriptionSnapshot[]): SubscriptionSnapshot | null {
  return subscriptions[subscriptions.length - 1] ?? null;
}

function appBaseUrlFromEnv(): string | null {
  const raw = process.env.APP_BASE_URL?.trim();
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

interface ConvertedLead {
  accountId: string | null;
  contactId: string | null;
  opportunityId: string | null;
}

async function readConvertedLead(config: SalesforceOAuthConfig, clinicId: string): Promise<ConvertedLead | null> {
  const lead = await getSalesforceRecordByExternalId({
    config,
    sobject: "Lead",
    externalIdField: SF_FIELDS.lead.externalId,
    externalId: clinicId,
    fields: ["IsConverted", "ConvertedAccountId", "ConvertedContactId", "ConvertedOpportunityId"],
  });
  if (!lead || lead.IsConverted !== true) return null;
  const str = (value: unknown) => (typeof value === "string" && value ? value : null);
  return {
    accountId: str(lead.ConvertedAccountId),
    contactId: str(lead.ConvertedContactId),
    opportunityId: str(lead.ConvertedOpportunityId),
  };
}

// SalesforceのIDは15桁/18桁の2表記があるため、先頭15桁で比較する。
function sameSalesforceId(a: string, b: string): boolean {
  return a.slice(0, 15) === b.slice(0, 15);
}

/**
 * 営業担当がLeadを取引開始(コンバート)した後も、同じ医院の更新を「コンバート先」の
 * Account/Contact/Opportunityへ続けて反映するため、コンバート先レコードへアプリの外部IDを設定する。
 * 同じ外部IDを持つ別レコードが既にある、またはコンバート先に別の外部IDが入っている場合は、
 * どちらかを自動で選んだり統合したりせず、要確認として同期を止める(重複の自動解消はしない)。
 */
async function adoptConvertedRecord(input: {
  config: SalesforceOAuthConfig;
  sobject: string;
  externalIdField: string;
  externalId: string;
  convertedId: string;
  beforeWrite: () => Promise<void>;
}): Promise<void> {
  const existing = await getSalesforceRecordByExternalId({
    config: input.config,
    sobject: input.sobject,
    externalIdField: input.externalIdField,
    externalId: input.externalId,
    fields: [],
  });
  if (existing) {
    if (sameSalesforceId(existing.Id, input.convertedId)) return;
    throw new PermanentSyncError(
      `converted_lead_conflict: コンバート先とは別の${input.sobject}が同じ外部IDを持っています(要確認・自動統合しません)`
    );
  }
  const converted = await getSalesforceRecordById({
    config: input.config,
    sobject: input.sobject,
    id: input.convertedId,
    fields: [input.externalIdField],
  });
  if (!converted) {
    throw new PermanentSyncError(`converted_lead_conflict: コンバート先の${input.sobject}が見つかりません(要確認)`);
  }
  const current = converted[input.externalIdField];
  if (typeof current === "string" && current && current !== input.externalId) {
    throw new PermanentSyncError(
      `converted_lead_conflict: コンバート先の${input.sobject}に別の外部IDが設定済みです(要確認・自動統合しません)`
    );
  }
  await input.beforeWrite();
  await updateSalesforceRecordById({
    config: input.config,
    sobject: input.sobject,
    id: input.convertedId,
    fields: { [input.externalIdField]: input.externalId },
  });
}

/**
 * 2026-10-03追加・2026-10-04修正(読み取り調査に基づく提案、承認待ち・未デプロイ)。
 * Contact upsertがSalesforce標準の重複ルールでHTTP 400 DUPLICATES_DETECTEDになった場合、
 * 無条件にallowSave=trueで再送しない。Salesforceが実際に返した重複候補一覧
 * (duplicateCandidates: オブジェクト種別+IDのみ、値は含まない)を取得し、
 * 「候補が1件以上あり、かつそのすべてが"この医院自身の、今回のContactと同じEmailを持つ、
 * 未コンバートのLead"と一致する」場合だけ再送する。
 * 以下はすべて「候補情報が不足」として扱い、確認なしにallowSaveは使わない(安全側に倒す):
 *   - 候補情報自体が返ってこない(includeRecordDetails非対応の環境・古いAPIバージョン等)
 *   - 候補が0件(構造はあるが中身がない)
 *   - 候補にContact等Lead以外のオブジェクトが含まれる(別医院のContactなど無関係な重複)
 *   - 候補のLead IDが、この医院自身のLead(外部ID=clinic.id)と一致しない
 *   - 複数の候補があり、その中に上記いずれかに該当しないものが1件でもある
 * これにより、「たまたま自分のLeadのEmailが一致していた」だけで、実際に検出された
 * 別の無関係な重複まで一緒に保存許可してしまう事故を減らす。
 *
 * 【既知の制約・未解消のリスク(2026-10-04時点、デプロイ前に記録)】
 * Salesforceの`Sforce-Duplicate-Rule-Header`のallowSaveは、特定の候補ID「だけ」を
 * 保存許可する仕組みではなく、「この1回の保存リクエスト全体」に対して重複アラートを
 * 無視するかどうかのフラグでしかない。つまり、1回目のリクエスト(失敗・候補取得)と
 * 2回目のリクエスト(allowSave=trueでの再送)は別々のAPI呼び出しであり、その間に
 * (別プロセスによる書き込み・Salesforce側の非同期インデックス更新などで)実際に
 * 検出される重複の中身が変わる余地が理論上ある。本実装は1回目で取得した候補一覧を
 * 検証してから2回目を送るが、2回目の時点でSalesforceが再評価する重複集合そのものを
 * 指定・固定する手段はAPI上存在しないため、「無関係な重複を保存許可することを
 * 完全に防げる」とは言い切れない。現実的な発生可能性は極めて低い(同一医院・同一
 * メールのLeadという限定された条件下でのみ再送する設計のため)が、断定しない。
 */
export async function upsertContactAllowingOwnLeadDuplicate(input: {
  config: SalesforceOAuthConfig;
  clinic: ClinicSnapshot;
  contact: ContactSnapshot;
  fields: Record<string, unknown>;
  beforeWrite: () => Promise<void>;
}): Promise<void> {
  const { config, clinic, contact, fields, beforeWrite } = input;
  await beforeWrite();
  try {
    await upsertSalesforceRecordByExternalId({
      config,
      sobject: "Contact",
      externalIdField: SF_FIELDS.contact.externalId,
      externalId: contact.id,
      fields,
      includeDuplicateRecordDetails: true,
    });
    return;
  } catch (error) {
    if (
      !(error instanceof SalesforceDeliveryError) ||
      error.errorCode !== DUPLICATES_DETECTED_ERROR_CODE
    ) {
      throw error;
    }
    const candidates = error.duplicateCandidates;
    if (!candidates || candidates.length === 0) {
      // 候補情報が取れなかった場合、確認のしようがないため拒否を維持する。
      throw error;
    }
    const ownLead = await getSalesforceRecordByExternalId({
      config,
      sobject: "Lead",
      externalIdField: SF_FIELDS.lead.externalId,
      externalId: clinic.id,
      fields: ["Email", "IsConverted"],
    });
    const ownLeadEmail = typeof ownLead?.Email === "string" ? ownLead.Email.toLowerCase() : null;
    const ownLeadIsSafe =
      ownLead !== null && ownLead.IsConverted === false && ownLeadEmail === contact.email.toLowerCase();
    const allCandidatesAreOwnLead =
      ownLeadIsSafe &&
      candidates.every(
        (candidate) =>
          candidate.sobjectType === "Lead" &&
          typeof candidate.id === "string" &&
          sameSalesforceId(candidate.id, ownLead.Id)
      );
    if (!allCandidatesAreOwnLead) {
      // 候補の中に、この医院自身の未コンバートLead以外(別オブジェクト・別レコード)が
      // 1件でも含まれる可能性があるため、確認なしにallowSaveは使わない。
      throw error;
    }
    await beforeWrite();
    await upsertSalesforceRecordByExternalId({
      config,
      sobject: "Contact",
      externalIdField: SF_FIELDS.contact.externalId,
      externalId: contact.id,
      fields,
      allowDuplicateSave: true,
    });
  }
}

async function pushSnapshotToSalesforce(input: {
  config: SalesforceOAuthConfig;
  event: { id: string; eventType: string; contactId: string | null };
  snapshot: CrmSnapshot;
  beforeWrite: () => Promise<void>;
}): Promise<{ leadId: string | null }> {
  const { config, event, snapshot, beforeWrite } = input;
  const { clinic, contacts, subscriptions, diagnoses, consultations, activity } = snapshot;
  const primaryContact = primaryContactOf(contacts);
  const latestSubscription = latestSubscriptionOf(subscriptions);
  const appBaseUrl = appBaseUrlFromEnv();
  const summary = buildClinicSummaryFields({
    latestDiagnosis: diagnoses[0] ?? null,
    activity,
    consultations,
    now: new Date(),
  });
  const upsert = async (sobject: string, externalIdField: string, externalId: string, fields: Record<string, unknown>) => {
    await beforeWrite();
    return upsertSalesforceRecordByExternalId({ config, sobject, externalIdField, externalId, fields });
  };

  const converted = await readConvertedLead(config, clinic.id);

  // 2026-10-03修正(読み取り調査に基づく提案、承認待ち): 会員登録済み(hasAccount)の
  // 医院には、このブロックでAccount/Contactを別途upsertするため、Leadを毎回
  // 再upsertし続ける必要がない。むしろ未コンバートのLeadを残したまま同じ回の同期で
  // 直後にContactをupsertすると、Salesforce標準の「Standard Rule for Contacts with
  // Duplicate Leads」がそのLead(同一メール)を重複候補として検出し、Contact upsertが
  // HTTP 400 DUPLICATES_DETECTEDで失敗する事故が実際に発生した(2026-10-03調査)。
  // 診断のみの段階(hasAccountがfalse)ではLeadの作成・更新を継続する。
  const hasAccount = contacts.length > 0 || subscriptions.length > 0 || Boolean(converted?.accountId);

  // 1. Lead(無料診断の医院)。外部ID=医院ID。コンバート済みならLeadは更新せず、コンバート先へ引き継ぐ。
  let leadId: string | null = null;
  if (!converted && !hasAccount) {
    const lead = await upsert(
      "Lead",
      SF_FIELDS.lead.externalId,
      clinic.id,
      buildLeadFields({
        clinic,
        eventType: event.eventType,
        primaryContact,
        primarySubscription: latestSubscription,
        appBaseUrl,
        summary,
      })
    );
    leadId = lead.id || null;
  } else if (converted) {
    if (converted.accountId) {
      await adoptConvertedRecord({
        config,
        sobject: "Account",
        externalIdField: SF_FIELDS.account.externalId,
        externalId: clinic.id,
        convertedId: converted.accountId,
        beforeWrite,
      });
    }
    if (converted.contactId && primaryContact) {
      await adoptConvertedRecord({
        config,
        sobject: "Contact",
        externalIdField: SF_FIELDS.contact.externalId,
        externalId: primaryContact.id,
        convertedId: converted.contactId,
        beforeWrite,
      });
    }
    // コンバート時に作られた商談は、契約が1件だけの場合に限りその契約の商談として引き継ぐ
    // (複数契約のどれに当たるかは推測しない)。
    if (converted.opportunityId && subscriptions.length === 1) {
      await adoptConvertedRecord({
        config,
        sobject: "Opportunity",
        externalIdField: SF_FIELDS.opportunity.externalId,
        externalId: subscriptions[0]!.id,
        convertedId: converted.opportunityId,
        beforeWrite,
      });
    }
  }

  // 2. Account / Contact(会員登録済み、またはコンバート済みの医院)。外部ID=医院ID / ユーザーID。
  if (hasAccount) {
    await upsert(
      "Account",
      SF_FIELDS.account.externalId,
      clinic.id,
      buildAccountFields(clinic, { summary, latestSubscription, appBaseUrl })
    );
  }
  for (const contact of contacts) {
    await upsertContactAllowingOwnLeadDuplicate({
      config,
      clinic,
      contact,
      fields: buildContactFields({ clinic, contact }),
      beforeWrite,
    });
  }

  // 3. Opportunity(契約1件=商談1件)。外部ID=契約ID。Stripeの確定Webhookで更新されたDB値のみを使う。
  if (subscriptions.length > 0) {
    const stages = resolveOpportunityStageMap(process.env);
    for (const subscription of subscriptions) {
      await upsert(
        "Opportunity",
        SF_FIELDS.opportunity.externalId,
        subscription.id,
        buildOpportunityFields({ clinic, subscription, stages })
      );
    }
  }

  // 4. 診断履歴(外部ID=診断ID)と相談予約(外部ID=TimeRexの予約ID)。
  for (const diagnosis of diagnoses) {
    await upsert(
      SF_FIELDS.diagnosis.sobject,
      SF_FIELDS.diagnosis.externalId,
      diagnosis.id,
      buildDiagnosisFields({ clinicId: clinic.id, diagnosis, linkAccount: hasAccount, appBaseUrl })
    );
  }
  for (const consultation of consultations) {
    await upsert(
      SF_FIELDS.consultation.sobject,
      SF_FIELDS.consultation.externalId,
      consultation.timerexEventId,
      buildConsultationFields({
        clinicId: clinic.id,
        // 担当者(Contact)へは、そのContactがこの医院の会員として同期される場合だけ紐づける。
        consultation: contacts.some((c) => c.id === consultation.contactId)
          ? consultation
          : { ...consultation, contactId: null },
        linkAccount: hasAccount,
      })
    );
  }

  // 電話禁止(DentShift_Do_Not_Call__c)は同期で書き込まない。標準DoNotCallがこの組織に
  // 存在しないため、Sandbox限定のカスタム項目を追加した(Lead/Contactとも既定値true)。
  // 新規作成時の初期値はSalesforce項目自体の既定値(true)に任せ、担当者が医院の同意を
  // 得てから手動で解除する(DentShift_Do_Not_Call_Reason__cに根拠を記入、変更者・日時は
  // 項目履歴管理で自動記録)。同期が繰り返しこの項目を書き戻すと、担当者の承認済み変更を
  // 上書きしてしまうため、同期コードは一切この項目に触れない。
  // Lead→Contact/Accountのコンバート時の引き継ぎは、Salesforce標準の「リードの項目の
  // 対応付け」(Lead Convert Field Mapping)で設定済み(Sandbox dsverifyのみ)。

  return { leadId };
}

async function recordFailure(
  event: { id: string; eventType: string; retryCount: number; alertedAt: Date | null },
  message: string,
  permanent: boolean
): Promise<void> {
  const nextRetryCount = permanent ? MAX_RETRY_COUNT : event.retryCount + 1;
  const exhausted = nextRetryCount >= MAX_RETRY_COUNT;
  await prisma.integrationEvent.update({
    where: { id: event.id },
    data: {
      status: "failed",
      lastError: message.slice(0, 500),
      retryCount: nextRetryCount,
      lastAttemptedAt: new Date(),
      nextRetryAt: exhausted ? null : computeNextRetryAt(nextRetryCount),
    },
  });
  if (exhausted && !event.alertedAt) {
    await notifySalesforceSyncFailure({ eventId: event.id, eventType: event.eventType, lastError: message.slice(0, 300) });
    await prisma.integrationEvent.update({ where: { id: event.id }, data: { alertedAt: new Date() } });
  }
}

// 2026-10-03追加: "held" = 医院許可リスト(SALESFORCE_SYNC_CLINIC_ALLOWLIST)の対象外。
// 外部API呼び出しは0回、イベントの status / retryCount / nextRetryAt は変更しない
// (DBに新しいステータスは追加しない。処理結果としてのみ扱う)。
export type SyncOutcome = "disabled" | "skipped" | "synced" | "failed" | "busy" | "held";

/**
 * pending/failed状態の1件を同期する。Salesforce未接続(disabled)時は何もせず終了する
 * (診断・登録処理自体を止めない)。メールアドレスではなく、イベントに紐づく医院ID・
 * ユーザーID・契約IDを外部IDとしてSalesforceへupsertする。
 * 同じ医院の同期は医院単位のロックで直列化し、ロック取得後に読んだ最新のDB状態を送る。
 */
export async function syncIntegrationEvent(eventId: string): Promise<SyncOutcome> {
  const config = resolveSalesforceConfigFromProcessEnv();
  if (config.provider === "disabled") return "disabled";

  const event = await prisma.integrationEvent.findUnique({ where: { id: eventId } });
  if (!event || event.status === "synced") return "skipped";

  let clinicId: string | null = null;
  const ownerId = randomUUID();
  let locked = false;
  try {
    clinicId = await resolveClinicId(event);
    if (!clinicId) {
      throw new PermanentSyncError("no_clinic_id: 医院を特定できないイベントです(要確認)");
    }
    // 段階的同期ガード: 送信直前の共通地点(Cron・即時送信・初期同期・手動再送後の送信は
    // すべてこの関数を通る)。許可外は何もせず保持する(ロックも取らず、API呼び出しもしない)。
    if (!isClinicSyncAllowed(clinicId, resolveSalesforceSyncClinicAllowlistFromProcessEnv())) {
      return "held";
    }
    locked = await acquireCrmSyncLock(clinicId, ownerId);
    if (!locked) {
      // 同じ医院の同期が実行中。試行回数は消費せず、少し後に再試行する(実行中の同期の後に最新状態を送る)。
      await prisma.integrationEvent.update({
        where: { id: event.id },
        data: { nextRetryAt: new Date(Date.now() + LOCK_BUSY_RETRY_DELAY_MS) },
      });
      return "busy";
    }
    const snapshot = await loadCrmSnapshot(clinicId);
    if (!snapshot) {
      throw new PermanentSyncError("clinic_not_found: 医院レコードが見つかりません(要確認)");
    }
    const lockedClinicId = clinicId;
    const { leadId } = await pushSnapshotToSalesforce({
      config,
      event,
      snapshot,
      beforeWrite: async () => {
        // リース切れで他の同期に引き継がれていたら、古いスナップショットで上書きしないよう中断する。
        if (!(await renewCrmSyncLock(lockedClinicId, ownerId))) {
          throw new LockLostError("crm_sync_lock_lost: 同期ロックの有効期限が切れたため中断しました(自動再試行)");
        }
      },
    });
    await prisma.integrationEvent.update({
      where: { id: event.id },
      data: {
        status: "synced",
        externalId: leadId,
        processedAt: new Date(),
        lastAttemptedAt: new Date(),
        nextRetryAt: null,
      },
    });
    return "synced";
  } catch (error) {
    if (isConnectionLevelError(error)) {
      // 接続先組織の不一致・認証失敗はイベント個別の問題ではないため、試行回数を消費しない
      // (設定を直せば保留中のイベントがそのまま再送される)。
      await prisma.integrationEvent.update({
        where: { id: event.id },
        data: {
          lastError: error instanceof Error ? error.message.slice(0, 500) : "connection error",
          lastAttemptedAt: new Date(),
          nextRetryAt: new Date(Date.now() + CONNECTION_ERROR_RETRY_DELAY_MS),
        },
      });
      throw error;
    }
    const permanent = error instanceof PermanentSyncError;
    const message = error instanceof Error ? error.message : "unknown error";
    await recordFailure(event, message, permanent);
    if (!permanent) throw error;
    return "failed";
  } finally {
    if (locked && clinicId) {
      await releaseCrmSyncLock(clinicId, ownerId).catch((error) => {
        console.error("[salesforceSync] failed to release lock:", error instanceof Error ? error.message : error);
      });
    }
  }
}

/**
 * 指数バックオフの次回実行予定時刻を計算する(2^retryCount秒、上限30分)。
 */
export function computeNextRetryAt(retryCountAfterThisFailure: number, now: Date = new Date()): Date {
  const backoffMs = Math.min(2 ** retryCountAfterThisFailure * 1000, 1000 * 60 * 30);
  return new Date(now.getTime() + backoffMs);
}

/**
 * pending/failedイベントを一括で再試行する(Vercel Cronからの定期起動用、指数バックオフ)。
 * retryCountが上限に達したイベントはスキップし、手動対応が必要な状態として残す。
 */
export async function retryPendingIntegrationEvents(
  limit = 50
): Promise<{ attempted: number; stoppedReason?: "connection_error" | "allowlist_closed" }> {
  const config = resolveSalesforceConfigFromProcessEnv();
  if (config.provider === "disabled") return { attempted: 0 };

  // 段階的同期ガード: 許可リストが無い(未設定・空・不正)ならDBも参照せず終了する。
  // 許可リストが医院IDの列挙なら、抽出条件にも含めて許可外イベントが処理枠(limit)を
  // 占有しないようにする(送信直前の判定はsyncIntegrationEvent側でも行う)。
  const allowlist = resolveSalesforceSyncClinicAllowlistFromProcessEnv();
  if (allowlist.mode === "none") return { attempted: 0, stoppedReason: "allowlist_closed" };

  const now = new Date();
  const events = await prisma.integrationEvent.findMany({
    where: {
      status: { in: ["pending", "failed"] },
      retryCount: { lt: MAX_RETRY_COUNT },
      OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
      ...(allowlist.mode === "list" ? { clinicId: { in: [...allowlist.clinicIds] } } : {}),
    },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  let attempted = 0;
  for (const event of events) {
    attempted += 1;
    let stop = false;
    await syncIntegrationEvent(event.id).catch((error) => {
      console.error(`[salesforceSync] retry failed for ${event.id}:`, error instanceof Error ? error.message : error);
      // 接続先不一致・認証失敗では残りも同じ理由で失敗するため、この回の処理を打ち切る。
      stop = isConnectionLevelError(error);
    });
    if (stop) return { attempted, stoppedReason: "connection_error" };
  }
  return { attempted };
}
