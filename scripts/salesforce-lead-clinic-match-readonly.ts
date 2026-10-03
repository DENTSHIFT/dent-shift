// 2026-10-03追加(PO指示: 本番移行前のLead/Clinic読み取り照合)。
// 本人実行専用スクリプト。Claude(AI)はこのスクリプトを本番に対して実行しません
// (本番Salesforce/本番DBの読み取りは、このセッションの自動権限判定で拒否される項目のため、
// 迂回せず本人の実行に委ねる)。
//
// 目的: Salesforceの未変換Lead(IsConverted = false)と、DENT SHIFT DBのClinicを
//   外部ID(DentShift_Clinic_Id__c = Clinic.id)/メール/URL/名称 で突き合わせ、
//   手順書(docs/SALESFORCE_LEAD_MANUAL_CONVERSION_PROCEDURE_2026-10-03.md)の分類
//     一意一致 / 候補複数 / 一致なし / 情報不足
//   ごとの件数と対象ID(Lead Id・Clinic id)だけを出力する。
//
// 安全対策・制約:
//   - 読み取り専用。Salesforceへの書き込み(PATCH/POST/DELETE)、DBへの書き込みは一切行わない
//     (使用するのは querySalesforceRecords(GET /query)と prisma.*.findMany のみ)。
//   - コンソールには件数と接続先種別(sandbox/production の判定)だけを出す。
//   - 医院名・URL・メール等の個人情報は、コンソールにもファイルにも出力しない。
//     ファイル(scripts/output/、.gitignore済み)にはLead Id・Clinic id・分類・一致根拠の種類だけを書く。
//   - 外部ID未設定のLeadは「自動照合対象外(個別確認)」として件数のみ計上し、
//     名称/URL/メールでの照合結果は参考情報(hint)として同じ分類表に載せるが、
//     手順書8.3の運用ルールどおり、これをもって自動変換・外部ID補完は行わない。
//
// 誤接続防止(停止条件):
//   - Salesforce: OAuth応答の組織IDが SALESFORCE_EXPECTED_ORG_ID と一致しなければ、
//     salesforceClient.getAccessToken が ORG_MISMATCH で例外を投げ、照会前に停止する。
//   - DB: --expect-db-host <ホスト名> を必須にし、DATABASE_URL のホスト名と一致しなければ
//     DBに接続する前に停止する(接続文字列そのものは表示しない。ホスト名のみ表示)。
//   - 本番照合のつもりでSandboxに繋いだ(またはその逆)場合に気付けるよう、Salesforceの
//     接続先種別(sandbox / production_or_unknown)を開始時に表示する。
//
// 事前準備(実行前に本人が行う。秘密値をコマンドラインに直接書かない):
//   秘密値はファイル(例: salesforce/.env.production-readonly、リポジトリ外・gitignore対象)に置き、
//     set -a; source <そのファイル>; set +a
//   で環境変数に読み込む(コマンド履歴に値が残らない)。必要な変数:
//   DATABASE_URL(照合したいDB)、SALESFORCE_CLIENT_ID / SALESFORCE_CLIENT_SECRET /
//   SALESFORCE_LOGIN_URL / SALESFORCE_EXPECTED_ORG_ID(照合したい組織)。
//   SALESFORCE_PROVIDER の値は参照しない(disabledのままでよい)。
//
// 使い方:
//   cd /Users/masatokimura/Documents/dent-shift
//   set -a; source <秘密値ファイル>; set +a
//   npx tsx --conditions=react-server scripts/salesforce-lead-clinic-match-readonly.ts --expect-db-host <DBホスト名>
//   (--out <path> で出力ファイルの場所を変更可。既定は scripts/output/lead-clinic-match-<timestamp>.json)

import { mkdirSync, writeFileSync } from "node:fs";
import { prisma } from "../src/server/db/prismaClient";
import { parseSalesforceCredentialsForDiagnosticsOnly, SalesforceConfigError } from "../src/server/config/salesforceConfig";
import { querySalesforceRecords } from "../src/server/providers/salesforce/salesforceClient";
import { SF_FIELDS } from "../src/domain/integration/salesforceCrmMapping";

type MatchKind = "external_id" | "email" | "url" | "name";
type Classification = "unique" | "multiple" | "none" | "insufficient";

interface LeadRow {
  Id: string;
  Company: string | null;
  Website: string | null;
  Email: string | null;
  externalId: string | null;
}

interface ClinicRow {
  id: string;
  name: string;
  url: string;
  contactEmail: string | null;
  ownerEmails: string[];
}

interface MatchResult {
  leadId: string;
  hasExternalId: boolean;
  classification: Classification;
  // 一致した根拠の種類と、その根拠で一致したClinic id(値そのものは含めない)
  matches: Array<{ kind: MatchKind; clinicIds: string[] }>;
  candidateClinicIds: string[];
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function normalizeEmail(value: string | null | undefined): string | null {
  const v = value?.trim().toLowerCase();
  return v ? v : null;
}

function normalizeHost(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const host = new URL(withScheme).hostname.toLowerCase();
    return host.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

function normalizeName(value: string | null | undefined): string | null {
  const v = value
    ?.normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/[　]/g, "")
    .toLowerCase();
  return v ? v : null;
}

function addToIndex(index: Map<string, Set<string>>, key: string | null, clinicId: string) {
  if (!key) return;
  const set = index.get(key) ?? new Set<string>();
  set.add(clinicId);
  index.set(key, set);
}

async function main() {
  const outPath = argValue("--out") ?? `scripts/output/lead-clinic-match-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;

  let config;
  try {
    config = parseSalesforceCredentialsForDiagnosticsOnly({ env: process.env });
  } catch (error) {
    if (error instanceof SalesforceConfigError) {
      console.error(`Salesforce認証情報が不足しています: ${error.message}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
  const loginHost = new URL(config.loginUrl).host;
  const targetKind = /--[^.]+\.sandbox\./.test(loginHost) ? "sandbox" : "production_or_unknown";

  // DB接続先の確認(接続前に停止できるようにする)。値そのものは表示しない。
  const expectDbHost = argValue("--expect-db-host");
  if (!expectDbHost) {
    console.error("--expect-db-host <DATABASE_URLのホスト名> が必要です(誤ったDBへ接続しないための確認)。");
    process.exitCode = 1;
    return;
  }
  let dbHost: string;
  try {
    dbHost = new URL(process.env.DATABASE_URL ?? "").hostname;
  } catch {
    console.error("DATABASE_URL が未設定、またはURLとして解釈できません。停止します。");
    process.exitCode = 1;
    return;
  }
  if (dbHost.toLowerCase() !== expectDbHost.toLowerCase()) {
    console.error(`DATABASE_URL のホスト名が --expect-db-host と一致しません(実際: ${dbHost})。停止します。`);
    process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify({ event: "start", salesforceTarget: targetKind, dbHost, mode: "read-only" }));

  // --- DB側(読み取りのみ) ---
  const clinics = await prisma.clinic.findMany({
    select: {
      id: true,
      name: true,
      url: true,
      contactEmail: true,
      contacts: { select: { email: true, role: true } },
    },
  });
  const clinicRows: ClinicRow[] = clinics.map((c) => ({
    id: c.id,
    name: c.name,
    url: c.url,
    contactEmail: c.contactEmail,
    ownerEmails: c.contacts.map((ct) => ct.email),
  }));

  const byId = new Map(clinicRows.map((c) => [c.id, c]));
  const byEmail = new Map<string, Set<string>>();
  const byHost = new Map<string, Set<string>>();
  const byName = new Map<string, Set<string>>();
  for (const c of clinicRows) {
    addToIndex(byEmail, normalizeEmail(c.contactEmail), c.id);
    for (const e of c.ownerEmails) addToIndex(byEmail, normalizeEmail(e), c.id);
    addToIndex(byHost, normalizeHost(c.url), c.id);
    addToIndex(byName, normalizeName(c.name), c.id);
  }

  // --- Salesforce側(読み取りのみ: GET /query) ---
  const ext = SF_FIELDS.lead.externalId;
  const soql = `SELECT Id, Company, Website, Email, ${ext} FROM Lead WHERE IsConverted = false`;
  const leadRecords = await querySalesforceRecords({ config, soql });
  const leads: LeadRow[] = leadRecords.map((r) => ({
    Id: r.Id,
    Company: typeof r.Company === "string" ? r.Company : null,
    Website: typeof r.Website === "string" ? r.Website : null,
    Email: typeof r.Email === "string" ? r.Email : null,
    externalId: typeof r[ext] === "string" && (r[ext] as string).trim() ? (r[ext] as string).trim() : null,
  }));

  // --- 照合 ---
  const results: MatchResult[] = [];
  for (const lead of leads) {
    const matches: MatchResult["matches"] = [];
    if (lead.externalId) {
      matches.push({ kind: "external_id", clinicIds: byId.has(lead.externalId) ? [lead.externalId] : [] });
    }
    const emailKey = normalizeEmail(lead.Email);
    if (emailKey) matches.push({ kind: "email", clinicIds: [...(byEmail.get(emailKey) ?? [])] });
    const hostKey = normalizeHost(lead.Website);
    if (hostKey) matches.push({ kind: "url", clinicIds: [...(byHost.get(hostKey) ?? [])] });
    const nameKey = normalizeName(lead.Company);
    if (nameKey) matches.push({ kind: "name", clinicIds: [...(byName.get(nameKey) ?? [])] });

    const candidates = new Set<string>();
    for (const m of matches) for (const id of m.clinicIds) candidates.add(id);

    let classification: Classification;
    if (matches.length === 0) classification = "insufficient";
    else if (candidates.size === 0) classification = "none";
    else if (candidates.size === 1) classification = "unique";
    else classification = "multiple";

    results.push({
      leadId: lead.Id,
      hasExternalId: lead.externalId !== null,
      classification,
      matches,
      candidateClinicIds: [...candidates],
    });
  }

  const count = (pred: (r: MatchResult) => boolean) => results.filter(pred).length;
  const summary = {
    salesforceTarget: targetKind,
    clinicsInDb: clinicRows.length,
    unconvertedLeads: leads.length,
    leadsWithExternalId: count((r) => r.hasExternalId),
    leadsWithoutExternalId: count((r) => !r.hasExternalId),
    externalIdFoundInDb: count((r) => r.matches.some((m) => m.kind === "external_id" && m.clinicIds.length === 1)),
    externalIdNotFoundInDb: count((r) => r.matches.some((m) => m.kind === "external_id" && m.clinicIds.length === 0)),
    classification: {
      unique: count((r) => r.classification === "unique"),
      multiple: count((r) => r.classification === "multiple"),
      none: count((r) => r.classification === "none"),
      insufficient: count((r) => r.classification === "insufficient"),
    },
    // 外部IDあり/なし別の内訳(8.3運用ルール: 外部ID未設定は自動照合対象外・個別確認)
    classificationByExternalId: {
      withExternalId: {
        unique: count((r) => r.hasExternalId && r.classification === "unique"),
        multiple: count((r) => r.hasExternalId && r.classification === "multiple"),
        none: count((r) => r.hasExternalId && r.classification === "none"),
        insufficient: count((r) => r.hasExternalId && r.classification === "insufficient"),
      },
      withoutExternalId_manualReviewOnly: {
        unique_hint: count((r) => !r.hasExternalId && r.classification === "unique"),
        multiple_hint: count((r) => !r.hasExternalId && r.classification === "multiple"),
        none: count((r) => !r.hasExternalId && r.classification === "none"),
        insufficient: count((r) => !r.hasExternalId && r.classification === "insufficient"),
      },
    },
    // 外部IDは一致するが、メール/URL/名称のいずれかが別のClinicを指す(外部IDの誤設定の疑い)
    externalIdConflictsWithOtherSignals: count(
      (r) =>
        r.hasExternalId &&
        r.matches.some((m) => m.kind === "external_id" && m.clinicIds.length === 1) &&
        r.candidateClinicIds.length > 1
    ),
  };

  mkdirSync("scripts/output", { recursive: true });
  writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), summary, results }, null, 2));
  console.log(JSON.stringify({ event: "summary", ...summary }));
  console.log(JSON.stringify({ event: "written", outPath, note: "ファイルにはLead Id・Clinic id・分類のみ(個人情報なし)" }));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
