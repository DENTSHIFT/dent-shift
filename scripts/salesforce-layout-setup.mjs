#!/usr/bin/env node
/**
 * 担当者が見る画面(ページレイアウト)へ「DENT SHIFT」セクションと関連リストを追加する(Tooling API)。
 * - 既存のセクション・項目・関連リストは変更せず、無ければ追加するだけ(何度実行しても同じ結果)。
 * - 既定はドライラン(追加予定の内容を表示するだけ)。--apply で反映。
 * - 本番組織では --allow-production を付けない限り反映しない(承認後のみ付ける)。
 *
 *   set -a; source salesforce/.env.sandbox; set +a
 *   node scripts/salesforce-layout-setup.mjs            # ドライラン
 *   node scripts/salesforce-layout-setup.mjs --apply    # Sandboxへ反映
 */
import fs from "node:fs";
import path from "node:path";

const API = "v60.0";
const apply = process.argv.includes("--apply");
const allowProduction = process.argv.includes("--allow-production");
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const spec = JSON.parse(fs.readFileSync(path.join(ROOT, "salesforce/tools/fields.json"), "utf8"));

const SECTION_LABEL = "DENT SHIFT";
const fieldsOf = (object) =>
  spec.objects[object].fields
    .flatMap((f) => (f[0] === "@summary" ? spec.summary : [f]))
    .filter((f) => f[1] !== "Lookup")
    .map((f) => f[0]);

// オブジェクトごとに追加する項目と関連リスト。
const PLAN = {
  Lead: { fields: fieldsOf("Lead"), relatedLists: [] },
  Account: {
    fields: fieldsOf("Account"),
    relatedLists: [
      { relatedList: "DentShift_Diagnosis__c.DentShift_Account__c", fields: ["NAME", "DentShift_Measured_At__c", "DentShift_Total_Score__c", "DentShift_Total_Status__c", "DentShift_Provisional__c"] },
      { relatedList: "DentShift_Consultation__c.DentShift_Account__c", fields: ["NAME", "DentShift_Start_At__c", "DentShift_Booking_Status__c", "DentShift_Attendance__c", "DentShift_Host_Name__c"] },
    ],
  },
  Contact: {
    fields: fieldsOf("Contact"),
    relatedLists: [
      { relatedList: "DentShift_Consultation__c.DentShift_Contact__c", fields: ["NAME", "DentShift_Start_At__c", "DentShift_Booking_Status__c", "DentShift_Attendance__c"] },
    ],
  },
  Opportunity: { fields: fieldsOf("Opportunity"), relatedLists: [] },
  DentShift_Diagnosis__c: { fields: ["DentShift_Account__c", ...fieldsOf("DentShift_Diagnosis__c")], relatedLists: [] },
  DentShift_Consultation__c: {
    fields: ["DentShift_Account__c", "DentShift_Contact__c", ...fieldsOf("DentShift_Consultation__c")],
    relatedLists: [],
  },
};
// 担当者が入力する項目だけ編集可能、それ以外(連携が書き込む項目)は読み取り専用で配置する。
const EDITABLE = new Set(["DentShift_Attendance__c", "DentShift_Staff_Notes__c"]);

function env(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`環境変数 ${name} が必要です。`);
  return value;
}

async function session() {
  const res = await fetch(`${new URL(env("SALESFORCE_LOGIN_URL")).origin}/services/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: env("SALESFORCE_CLIENT_ID"), client_secret: env("SALESFORCE_CLIENT_SECRET") }),
  });
  if (!res.ok) throw new Error(`OAuth failed: HTTP ${res.status}`);
  const body = await res.json();
  if (body.id.split("/id/")[1].split("/")[0].slice(0, 15) !== env("SALESFORCE_EXPECTED_ORG_ID").slice(0, 15)) {
    throw new Error("接続先の組織IDが SALESFORCE_EXPECTED_ORG_ID と一致しません。");
  }
  const call = async (p, init = {}) => {
    const r = await fetch(`${body.instance_url}/services/data/${API}${p}`, {
      ...init,
      headers: { Authorization: `Bearer ${body.access_token}`, "Content-Type": "application/json" },
    });
    if (!r.ok) throw new Error(`${init.method ?? "GET"} ${p.split("?")[0]}: HTTP ${r.status} ${(await r.text()).slice(0, 300)}`);
    return r.status === 204 ? null : r.json();
  };
  return { call };
}

async function main() {
  const sf = await session();
  const org = (await sf.call(`/query?q=${encodeURIComponent("SELECT IsSandbox FROM Organization")}`)).records[0];
  if (apply && !org.IsSandbox && !allowProduction) throw new Error("本番組織です。承認後に --allow-production を付けて実行してください。");

  for (const [object, plan] of Object.entries(PLAN)) {
    const layouts = (
      await sf.call(`/tooling/query?q=${encodeURIComponent(`SELECT Id, Name FROM Layout WHERE TableEnumOrId = '${object}'`)}`)
    ).records;
    for (const layout of layouts) {
      const full = await sf.call(`/tooling/sobjects/Layout/${layout.Id}`);
      const metadata = full.Metadata;
      const present = new Set(
        metadata.layoutSections.flatMap((s) => (s.layoutColumns ?? []).flatMap((c) => (c.layoutItems ?? []).map((i) => i.field)))
      );
      const missing = plan.fields.filter((f) => !present.has(f));
      const lists = new Set((metadata.relatedLists ?? []).map((r) => r.relatedList));
      const missingLists = plan.relatedLists.filter((r) => !lists.has(r.relatedList));
      console.log(`${object} / ${layout.Name}: 追加項目${missing.length}件, 追加関連リスト${missingLists.length}件`);
      if (!apply || (missing.length === 0 && missingLists.length === 0)) continue;

      if (missing.length) {
        const half = Math.ceil(missing.length / 2);
        const item = (field) => ({ field, behavior: EDITABLE.has(field) ? "Edit" : "Readonly" });
        metadata.layoutSections.push({
          label: SECTION_LABEL,
          customLabel: true,
          detailHeading: true,
          editHeading: true,
          style: "TwoColumnsTopToBottom",
          layoutColumns: [{ layoutItems: missing.slice(0, half).map(item) }, { layoutItems: missing.slice(half).map(item) }],
        });
      }
      metadata.relatedLists = [...(metadata.relatedLists ?? []), ...missingLists];
      await sf.call(`/tooling/sobjects/Layout/${layout.Id}`, { method: "PATCH", body: JSON.stringify({ Metadata: metadata }) });
      console.log("  → 反映しました");
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
