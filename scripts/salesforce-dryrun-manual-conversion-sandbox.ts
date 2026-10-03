/**
 * 2026-10-03追加(PO限定承認: Sandbox dsverify での手動Lead変換ドライラン)。
 * 計画: docs/SALESFORCE_MANUAL_CONVERSION_DRY_RUN_PLAN_2026-10-03.md
 *
 * サブコマンド:
 *   precheck  読み取りのみ。接続先確認、有効ユーザー構成、既存【DRYRUN-MC】レコード有無、
 *             Opportunity件数・変換済みLead件数の基準値を出す。
 *   create    計画1.2のダミーレコード(Account 3 / Contact 1 / Lead 6 / Task 1 / Event 1)を作成する。
 *             既に【DRYRUN-MC】レコードが存在する場合は作成せず停止する(二重作成防止)。
 *   verify    読み取りのみ。変換前/変換後の確認SOQL(計画2章・Step 5)を実行し結果を出す。
 *
 * 安全装置(e2eスクリプトと同じ):
 *   - My DomainがSandbox命名規則(`--<name>.sandbox.`)でなければ停止。
 *   - 組織IDがSALESFORCE_EXPECTED_ORG_IDと一致しなければ停止。
 *   - 書き込みはcreateサブコマンドの【DRYRUN-MC】レコード作成のみ。変換・更新・削除はしない
 *     (変換は管理者が画面で行う)。既存レコードには触れない。
 *   - 出力: レコードIdと件数のみ。人名・メール等は出さない(ダミーデータに個人情報は含めない)。
 *
 * 使い方:
 *   set -a; source salesforce/.env.sandbox; set +a
 *   npx tsx scripts/salesforce-dryrun-manual-conversion-sandbox.ts precheck
 *   npx tsx scripts/salesforce-dryrun-manual-conversion-sandbox.ts create --owner-id <005...>
 *   npx tsx scripts/salesforce-dryrun-manual-conversion-sandbox.ts verify
 */
import { mkdirSync, writeFileSync } from "node:fs";

const API = "v60.0";
const PREFIX = "【DRYRUN-MC】";
const DATE_TAG = "20261003";

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function session() {
  for (const name of ["SALESFORCE_CLIENT_ID", "SALESFORCE_CLIENT_SECRET", "SALESFORCE_LOGIN_URL", "SALESFORCE_EXPECTED_ORG_ID"]) {
    if (!process.env[name]) throw new Error(`${name} が必要です(salesforce/.env.sandbox を source する)`);
  }
  const loginHost = new URL(process.env.SALESFORCE_LOGIN_URL!).host;
  if (!/--[^.]+\.sandbox\./.test(loginHost)) {
    throw new Error("接続先がSandboxではありません。本番組織では実行しません。");
  }
  const loginUrl = new URL(process.env.SALESFORCE_LOGIN_URL!).origin;
  const res = await fetch(`${loginUrl}/services/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.SALESFORCE_CLIENT_ID!,
      client_secret: process.env.SALESFORCE_CLIENT_SECRET!,
    }),
  });
  if (!res.ok) throw new Error(`OAuth failed: HTTP ${res.status}`);
  const body = (await res.json()) as { access_token: string; instance_url: string; id: string };
  const orgId = body.id.split("/id/")[1]!.split("/")[0]!;
  if (orgId.slice(0, 15) !== process.env.SALESFORCE_EXPECTED_ORG_ID!.slice(0, 15)) {
    throw new Error("接続先の組織IDが SALESFORCE_EXPECTED_ORG_ID と一致しません。停止します。");
  }
  const call = async (pathname: string, init: RequestInit = {}) => {
    const r = await fetch(`${body.instance_url}/services/data/${API}${pathname}`, {
      ...init,
      headers: { Authorization: `Bearer ${body.access_token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    });
    if (!r.ok) throw new Error(`${init.method ?? "GET"} ${pathname}: HTTP ${r.status} ${(await r.text()).slice(0, 300)}`);
    return r.status === 204 ? null : r.json();
  };
  const soql = async <T = Record<string, unknown>>(q: string): Promise<T[]> => {
    const out: T[] = [];
    let page = (await call(`/query?q=${encodeURIComponent(q)}`)) as { records: T[]; done: boolean; nextRecordsUrl?: string };
    out.push(...page.records);
    while (!page.done && page.nextRecordsUrl) {
      page = (await call(page.nextRecordsUrl.replace(`/services/data/${API}`, ""))) as typeof page;
      out.push(...page.records);
    }
    return out;
  };
  const count = async (q: string) => ((await call(`/query?q=${encodeURIComponent(q)}`)) as { totalSize: number }).totalSize;
  const create = async (sobject: string, fields: Record<string, unknown>) => {
    const r = (await call(`/sobjects/${sobject}`, { method: "POST", body: JSON.stringify(fields) })) as { id: string; success: boolean };
    if (!r.success) throw new Error(`${sobject} create failed`);
    return r.id;
  };
  const fieldExists = async (sobject: string, field: string) => {
    const d = (await call(`/sobjects/${sobject}/describe`)) as { fields: Array<{ name: string }> };
    return d.fields.some((f) => f.name === field);
  };
  const hasStdDoNotCall = { contact: await fieldExists("Contact", "DoNotCall"), lead: await fieldExists("Lead", "DoNotCall") };
  return { orgId, loginHost, call, soql, count, create, hasStdDoNotCall };
}

type SF = Awaited<ReturnType<typeof session>>;

async function precheck(sf: SF) {
  // 連携ユーザーはProfileリレーションを参照できない(INVALID_FIELD)ため、ProfileId・UserTypeのみ。
  const users = await sf.soql<{ Id: string; IsActive: boolean; UserType: string;  }>(
    "SELECT Id, IsActive, UserType FROM User WHERE IsActive = true"
  );
  console.log("active users (Id・ProfileId・UserTypeのみ、氏名は出さない):");
  for (const u of users) console.log(`  ${u.Id} type=${u.UserType}`);
  console.log(`standard Contact.DoNotCall exists: ${sf.hasStdDoNotCall.contact} / Lead.DoNotCall exists: ${sf.hasStdDoNotCall.lead}`);
  const existing = await sf.count(`SELECT COUNT() FROM Lead WHERE Name LIKE '${PREFIX}%'`);
  const existingAcc = await sf.count(`SELECT COUNT() FROM Account WHERE Name LIKE '${PREFIX}%'`);
  const existingCon = await sf.count(`SELECT COUNT() FROM Contact WHERE Name LIKE '${PREFIX}%'`);
  console.log(`existing ${PREFIX} records: Lead=${existing} Account=${existingAcc} Contact=${existingCon}`);
  console.log(`baseline: Opportunity total=${await sf.count("SELECT COUNT() FROM Opportunity")}`);
  console.log(`baseline: converted non-dryrun Leads=${await sf.count(`SELECT COUNT() FROM Lead WHERE IsConverted = true AND (NOT Name LIKE '${PREFIX}%')`)}`);
  console.log(`baseline: Lead total=${await sf.count("SELECT COUNT() FROM Lead")} Account total=${await sf.count("SELECT COUNT() FROM Account")} Contact total=${await sf.count("SELECT COUNT() FROM Contact")}`);
  const contactFields = (await sf.call("/sobjects/Contact/describe")) as { fields: Array<{ name: string; type: string; defaultValue: unknown }> };
  for (const f of contactFields.fields.filter((f) => f.name === "DoNotCall" || f.name === "DentShift_Do_Not_Call__c")) {
    console.log(`Contact field ${f.name}: type=${f.type} default=${JSON.stringify(f.defaultValue)}`);
  }
  // 営業リスト(リストビュー)が電話禁止項目を参照しているか(読み取りのみ、名前と絞り込み条件のみ)。
  for (const obj of ["Lead", "Contact"]) {
    const lv = (await sf.call(`/sobjects/${obj}/listviews`)) as { listviews: Array<{ id: string; label: string; describeUrl: string }> };
    for (const v of lv.listviews) {
      const d = (await sf.call(v.describeUrl.replace(`/services/data/${API}`, ""))) as { query: string };
      const hit = /Do_Not_Call|DoNotCall/i.test(d.query);
      console.log(`listview ${obj} "${v.label}" refsDoNotCall=${hit}${hit ? ` query=${d.query}` : ""}`);
    }
  }
  const leadFields = (await sf.call("/sobjects/Lead/describe")) as { fields: Array<{ name: string; type: string; defaultValue: unknown }> };
  for (const f of leadFields.fields.filter((f) => f.name === "DoNotCall" || f.name === "DentShift_Do_Not_Call__c")) {
    console.log(`Lead field ${f.name}: type=${f.type} default=${JSON.stringify(f.defaultValue)}`);
  }
}

async function create(sf: SF) {
  const ownerId = argValue("--owner-id");
  if (!ownerId || !/^005/.test(ownerId)) throw new Error("--owner-id <実行者のUser Id(005...)> が必要です");
  const existing = await sf.count(`SELECT COUNT() FROM Lead WHERE Name LIKE '${PREFIX}%'`);
  if (existing > 0) throw new Error(`既に ${PREFIX} Leadが${existing}件あります。二重作成を避けるため停止します。`);

  const ext = (s: string) => `dryrun-mc-${DATE_TAG}-s${s}-clinic`;
  const domain = (s: string) => `dryrun-mc-s${s}.invalid`;
  const ids: Record<string, string> = {};
  // 検証ルール DentShift_Do_Not_Call_Reason_Required: false(通話可)なら根拠必須。
  // (管理者が画面で入力する根拠文: 「【DRYRUN-MC】検証用ダミー(実在の同意ではない)」)
  const stdContact = (v: boolean) => (sf.hasStdDoNotCall.contact ? { DoNotCall: v } : {});
  const stdLead = (v: boolean) => (sf.hasStdDoNotCall.lead ? { DoNotCall: v } : {});

  // Account 3件 (a)(b)(d)。(d)は第2ユーザーが無いため実行者Ownerで作成し、計画1.3のとおり(d)は未検証扱い。
  // 途中失敗からの再実行用: 同名Accountが既にあれば再作成しない。
  const accountOrCreate = async (name: string, fields: Record<string, unknown>) => {
    const found = await sf.soql<{ Id: string }>(`SELECT Id FROM Account WHERE Name = '${name}'`);
    if (found.length > 1) throw new Error(`Account "${name}" が${found.length}件あります。停止します。`);
    return found[0]?.Id ?? sf.create("Account", { Name: name, ...fields });
  };
  ids.accountSa = await accountOrCreate(`${PREFIX}Sa 既存Account`, { DentShift_Clinic_Id__c: ext("a"), DentShift_Site_Domain__c: domain("a"), OwnerId: ownerId });
  ids.accountSb = await accountOrCreate(`${PREFIX}Sb 既存Account`, { DentShift_Clinic_Id__c: ext("b"), DentShift_Site_Domain__c: domain("b"), OwnerId: ownerId });
  const sdOwner = argValue("--sd-owner-id") ?? ownerId;
  ids.accountSd = await accountOrCreate(`${PREFIX}Sd 既存Account(別Owner)`, { DentShift_Clinic_Id__c: ext("d"), DentShift_Site_Domain__c: domain("d"), OwnerId: sdOwner });
  // Contact 1件 (b)。DoNotCall両項目ともfalse。
  ids.contactSb = await sf.create("Contact", {
    LastName: `${PREFIX}Sb 既存Contact`, AccountId: ids.accountSb, DentShift_User_Id__c: `dryrun-mc-${DATE_TAG}-sb-user`,
    // 連携ユーザーは電話禁止項目(DentShift_Do_Not_Call__c / _Reason__c)を書けない(設計どおり、
    // INVALID_FIELD_FOR_INSERT_UPDATE)。既定値trueで作成し、false化+根拠は管理者が画面で行う。
    ...stdContact(false), OwnerId: ownerId,
  });
  // Lead 6件。(e)以外はDentShift_Do_Not_Call__c=false を明示。
  const lead = (s: string, label: string, extra: Record<string, unknown>) =>
    sf.create("Lead", {
      LastName: `${PREFIX}S${s} ${label}`, Company: `${PREFIX}S${s} ${label}`, OwnerId: ownerId,
      ...stdLead(false), ...extra, // 電話禁止項目は連携ユーザーが書けないため既定値(true)のまま。管理者が画面でfalse化する
    });
  ids.leadSa = await lead("a", "Lead", { DentShift_Clinic_Id__c: ext("a"), DentShift_Site_Domain__c: domain("a") });
  ids.leadSb = await lead("b", "Lead", { DentShift_Clinic_Id__c: ext("b"), DentShift_Site_Domain__c: domain("b") });
  ids.leadSc = await lead("c", "Lead(外部ID未設定)", {});
  ids.leadSd = await lead("d", "Lead", { DentShift_Clinic_Id__c: ext("d"), DentShift_Site_Domain__c: domain("d") });
  ids.leadSe = await lead("e", "Lead(電話禁止)", { DentShift_Clinic_Id__c: ext("e"), DentShift_Site_Domain__c: domain("e"), ...stdLead(true) }); // 既定値trueのまま=電話禁止
  ids.leadSf = await lead("f", "Lead(活動あり)", { DentShift_Clinic_Id__c: ext("f"), DentShift_Site_Domain__c: domain("f") });
  // 活動 (f): 連携ユーザーはTask/Eventにアクセスできない(sObject type not supported)ため、管理者が画面で作成する。

  mkdirSync("scripts/output", { recursive: true });
  const out = `scripts/output/dryrun-mc-${DATE_TAG}-created.json`;
  writeFileSync(out, JSON.stringify({ createdAt: new Date().toISOString(), orgId: sf.orgId.slice(0, 15), ids }, null, 2));
  console.log(JSON.stringify({ event: "created", ids, out }));
}

async function verify(sf: SF) {
  const stdL = sf.hasStdDoNotCall.lead ? ", DoNotCall" : "";
  const stdC = sf.hasStdDoNotCall.contact ? ", DoNotCall" : "";
  const leads = await sf.soql(
    `SELECT Id, Name, IsConverted, DentShift_Clinic_Id__c, OwnerId, DentShift_Do_Not_Call__c, DentShift_Do_Not_Call_Reason__c${stdL}, ConvertedAccountId, ConvertedContactId, ConvertedOpportunityId FROM Lead WHERE Name LIKE '${PREFIX}%' ORDER BY Name`
  );
  console.log("Leads:");
  for (const l of leads) console.log(" ", JSON.stringify(l, (k, v) => (k === "attributes" ? undefined : v)));
  const accounts = await sf.soql(`SELECT Id, Name, DentShift_Clinic_Id__c, OwnerId FROM Account WHERE Name LIKE '${PREFIX}%' ORDER BY Name`);
  console.log("Accounts:");
  for (const a of accounts) console.log(" ", JSON.stringify(a, (k, v) => (k === "attributes" ? undefined : v)));
  const contacts = await sf.soql(
    `SELECT Id, Name, AccountId, OwnerId, DentShift_User_Id__c, DentShift_Do_Not_Call__c, DentShift_Do_Not_Call_Reason__c${stdC} FROM Contact WHERE Name LIKE '${PREFIX}%' ORDER BY Name`
  );
  console.log("Contacts:");
  for (const c of contacts) console.log(" ", JSON.stringify(c, (k, v) => (k === "attributes" ? undefined : v)));
  for (const obj of ["Task", "Event"]) {
    try {
      const rows = await sf.soql(`SELECT Id, Subject, WhoId, WhatId FROM ${obj} WHERE Subject LIKE '${PREFIX}%'`);
      console.log(`${obj}s:`, JSON.stringify(rows, (k, v) => (k === "attributes" ? undefined : v)));
    } catch {
      console.log(`${obj}s: (連携ユーザーでは参照不可。管理者が画面の活動関連リストで確認)`);
    }
  }
  console.log(`Opportunity total=${await sf.count("SELECT COUNT() FROM Opportunity")} dryrun=${await sf.count(`SELECT COUNT() FROM Opportunity WHERE Name LIKE '${PREFIX}%'`)}`);
  console.log(`converted non-dryrun Leads=${await sf.count(`SELECT COUNT() FROM Lead WHERE IsConverted = true AND (NOT Name LIKE '${PREFIX}%')`)}`);
  console.log(`totals: Lead=${await sf.count("SELECT COUNT() FROM Lead")} Account=${await sf.count("SELECT COUNT() FROM Account")} Contact=${await sf.count("SELECT COUNT() FROM Contact")}`);
}

async function main() {
  const cmd = process.argv[2];
  const sf = await session();
  console.log(`connected: host=${sf.loginHost} org=${sf.orgId.slice(0, 15)} (sandbox)`);
  if (cmd === "precheck") return precheck(sf);
  if (cmd === "create") return create(sf);
  if (cmd === "verify") return verify(sf);
  throw new Error("subcommand: precheck | create | verify");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
