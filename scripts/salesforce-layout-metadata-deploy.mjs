#!/usr/bin/env node
/**
 * 担当者が見る画面(ページレイアウト)へ「DENT SHIFT」セクションと関連リストを追加する。
 *
 * salesforce-layout-setup.mjs (Tooling API PATCH)は、Lead/Account/Contact/Opportunityの
 * 全レイアウトで「Mass quick actions don't support <entity>」エラーにより失敗することが
 * 判明した(各レイアウトの既存クイックアクションが参照するエンティティ:
 * Lead/Contact=ContentDocumentLink、Account=Partner、Opportunity=OpportunityLineItem)。
 * Salesforce Setup画面自体の標準レイアウトエディタでは無変更の保存が成功することを確認済みのため、
 * これはTooling API特有の制約であり、既存クイックアクションのデータが壊れているわけではない。
 *
 * REST Metadata API には汎用的な非同期retrieveエンドポイントが無い(`/metadata/retrieveRequest`は
 * 404、実機で確認済み)。Salesforceが公式に提供する唯一のメタデータretrieve手段は
 * SOAP Metadata API の retrieve() コールであり(Salesforce CLI 等の公式ツールも内部で
 * これを使用する)、本スクリプトではこれを使って既存レイアウトの実際のXMLをそのまま取得し、
 * 末尾(</Layout>の直前)に不足しているlayoutSections(DENT SHIFTセクション)と
 * relatedListsだけを文字列として追記し、それ以外は一切変更せずに
 * REST Metadata API の deployRequest(既存の salesforce-metadata-deploy.mjs と同じ、
 * 動作確認済みの経路)へ戻す。既存のクイックアクション・ボタン・概要レイアウト等は
 * 元のXMLのまま温存される。
 *
 * OAuthのアクセストークンは、SOAP APIのSessionHeaderにもそのまま使える
 * (Client Credentials Flowのトークンをセッションidとして使用。Salesforce公式の挙動)。
 *
 *   set -a; source salesforce/.env.sandbox-admin; set +a
 *   node scripts/salesforce-layout-metadata-deploy.mjs              # 検証のみ(retrieve+差分表示、deployはcheckOnly)
 *   node scripts/salesforce-layout-metadata-deploy.mjs --apply      # Sandboxへ反映
 */
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const API = "v60.0";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const apply = process.argv.includes("--apply");
const allowProduction = process.argv.includes("--allow-production");
const spec = JSON.parse(fs.readFileSync(path.join(ROOT, "salesforce/tools/fields.json"), "utf8"));

const SECTION_LABEL = "DENT SHIFT";
const fieldsOf = (object) =>
  spec.objects[object].fields
    .flatMap((f) => (f[0] === "@summary" ? spec.summary : [f]))
    .filter((f) => f[1] !== "Lookup")
    .map((f) => f[0]);
const EDITABLE = new Set(["DentShift_Attendance__c", "DentShift_Staff_Notes__c", "DentShift_Do_Not_Call__c", "DentShift_Do_Not_Call_Reason__c"]);

const LAYOUTS = {
  "Lead-Lead Layout": { object: "Lead", fields: fieldsOf("Lead"), relatedLists: [] },
  "Account-Account Layout": {
    object: "Account",
    fields: fieldsOf("Account"),
    relatedLists: [
      { relatedList: "DentShift_Diagnosis__c.DentShift_Account__c", fields: ["NAME", "DentShift_Measured_At__c", "DentShift_Total_Score__c", "DentShift_Total_Status__c", "DentShift_Provisional__c"] },
      { relatedList: "DentShift_Consultation__c.DentShift_Account__c", fields: ["NAME", "DentShift_Start_At__c", "DentShift_Booking_Status__c", "DentShift_Attendance__c", "DentShift_Host_Name__c"] },
    ],
  },
  "Contact-Contact Layout": {
    object: "Contact",
    fields: fieldsOf("Contact"),
    relatedLists: [{ relatedList: "DentShift_Consultation__c.DentShift_Contact__c", fields: ["NAME", "DentShift_Start_At__c", "DentShift_Booking_Status__c", "DentShift_Attendance__c"] }],
  },
  "Opportunity-Opportunity Layout": { object: "Opportunity", fields: fieldsOf("Opportunity"), relatedLists: [] },
};

function env(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`環境変数 ${name} が必要です。`);
  return value;
}

async function token() {
  const loginUrl = new URL(env("SALESFORCE_LOGIN_URL")).origin;
  const res = await fetch(`${loginUrl}/services/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: env("SALESFORCE_CLIENT_ID"), client_secret: env("SALESFORCE_CLIENT_SECRET") }),
  });
  if (!res.ok) throw new Error(`OAuth token request failed: HTTP ${res.status}`);
  const body = await res.json();
  const orgId = String(body.id ?? "").split("/id/")[1]?.split("/")[0] ?? "";
  if (orgId.slice(0, 15) !== env("SALESFORCE_EXPECTED_ORG_ID").slice(0, 15)) {
    throw new Error("接続先の組織IDが SALESFORCE_EXPECTED_ORG_ID と一致しません。中断します。");
  }
  const loginHost = new URL(env("SALESFORCE_LOGIN_URL")).host;
  if (!/--[^.]+\.sandbox\./.test(loginHost) && !allowProduction) {
    throw new Error("接続先がSandboxではありません。本番組織では --allow-production なしに実行しません。");
  }
  return { accessToken: body.access_token, instanceUrl: body.instance_url };
}

function soapEnvelope(auth, body) {
  // SOAP APIはHTTPのAuthorizationヘッダーではなく、SOAPヘッダーのSessionHeaderで認証する
  // (OAuthアクセストークンをそのままsessionIdとして使えるのはSalesforce公式の挙動)。
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:met="http://soap.sforce.com/2006/04/metadata">
  <soapenv:Header>
    <met:SessionHeader><met:sessionId>${auth.accessToken}</met:sessionId></met:SessionHeader>
  </soapenv:Header>
  <soapenv:Body>${body}</soapenv:Body>
</soapenv:Envelope>`;
}

async function soapCall(auth, action, bodyXml) {
  const res = await fetch(`${auth.instanceUrl}/services/Soap/m/${API.slice(1)}`, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml;charset=UTF-8",
      SOAPAction: action,
    },
    body: soapEnvelope(auth, bodyXml),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`SOAP ${action} failed: HTTP ${res.status} ${text.slice(0, 500)}`);
  return text;
}

function xmlTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? m[1] : null;
}

async function retrieveLayouts(auth, members) {
  const types = members.map((m) => `<met:types><met:members>${m}</met:members><met:name>Layout</met:name></met:types>`).join("");
  const retrieveBody = `<met:retrieve><met:retrieveRequest><met:apiVersion>${API.slice(1)}</met:apiVersion><met:unpackaged>${types}<met:version>${API.slice(1)}</met:version></met:unpackaged></met:retrieveRequest></met:retrieve>`;
  const startRes = await soapCall(auth, "retrieve", retrieveBody);
  const asyncId = xmlTag(startRes, "id");
  if (!asyncId) throw new Error(`retrieve() did not return an id: ${startRes.slice(0, 800)}`);

  for (;;) {
    await new Promise((r) => setTimeout(r, 3000));
    const statusBody = `<met:checkRetrieveStatus><met:asyncProcessId>${asyncId}</met:asyncProcessId><met:includeZip>true</met:includeZip></met:checkRetrieveStatus>`;
    const statusRes = await soapCall(auth, "checkRetrieveStatus", statusBody);
    const done = xmlTag(statusRes, "done");
    if (done !== "true") continue;
    const success = xmlTag(statusRes, "success");
    if (success !== "true") {
      const messages = [...statusRes.matchAll(/<messages>[\s\S]*?<problem>([^<]*)<\/problem>[\s\S]*?<\/messages>/g)].map((m) => m[1]);
      throw new Error(`retrieve failed: ${messages.join("; ") || statusRes.slice(0, 800)}`);
    }
    const zipBase64 = xmlTag(statusRes, "zipFile");
    if (!zipBase64) throw new Error(`checkRetrieveStatus returned success but no zipFile: ${statusRes.slice(0, 800)}`);
    return zipBase64;
  }
}

function missingFor(xml, fields, relatedLists) {
  const presentFields = new Set([...xml.matchAll(/<field>([^<]+)<\/field>/g)].map((m) => m[1]));
  const presentLists = new Set([...xml.matchAll(/<relatedList>([^<]+)<\/relatedList>/g)].map((m) => m[1]));
  return {
    missingFields: fields.filter((f) => !presentFields.has(f)),
    missingLists: relatedLists.filter((r) => !presentLists.has(r.relatedList)),
  };
}

function buildSectionXml(missingFields) {
  const half = Math.ceil(missingFields.length / 2);
  const col = (items) =>
    `        <layoutColumns>\n${items
      .map((f) => `            <layoutItems>\n                <behavior>${EDITABLE.has(f) ? "Edit" : "Readonly"}</behavior>\n                <field>${f}</field>\n            </layoutItems>`)
      .join("\n")}\n        </layoutColumns>`;
  return `    <layoutSections>
        <customLabel>true</customLabel>
        <detailHeading>true</detailHeading>
        <editHeading>true</editHeading>
        <label>${SECTION_LABEL}</label>
        <style>TwoColumnsTopToBottom</style>
${col(missingFields.slice(0, half))}
${col(missingFields.slice(half))}
    </layoutSections>`;
}

function buildRelatedListXml(r) {
  return `    <relatedLists>
${r.fields.map((f) => `        <fields>${f}</fields>`).join("\n")}
        <relatedList>${r.relatedList}</relatedList>
    </relatedLists>`;
}

async function deployZip(auth, zipBuffer, checkOnly) {
  const boundary = `----dentshift${crypto.randomBytes(16).toString("hex")}`;
  const jsonPart = JSON.stringify({ deployOptions: { checkOnly, singlePackage: true, rollbackOnError: true, testLevel: "NoTestRun" } });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="json"\r\nContent-Type: application/json\r\n\r\n${jsonPart}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="deploy.zip"\r\nContent-Type: application/zip\r\n\r\n`),
    zipBuffer,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const res = await fetch(`${auth.instanceUrl}/services/data/${API}/metadata/deployRequest`, {
    method: "POST",
    headers: { Authorization: `Bearer ${auth.accessToken}`, "Content-Type": `multipart/form-data; boundary=${boundary}`, "Content-Length": String(body.length) },
    body,
  });
  if (!res.ok) throw new Error(`deployRequest failed: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  const { id } = await res.json();
  for (;;) {
    await new Promise((r) => setTimeout(r, 3000));
    const poll = await fetch(`${auth.instanceUrl}/services/data/${API}/metadata/deployRequest/${id}?includeDetails=true`, { headers: { Authorization: `Bearer ${auth.accessToken}` } });
    const result = (await poll.json()).deployResult;
    if (!result?.done) continue;
    const failures = [result.details?.componentFailures ?? []].flat();
    console.log(`status=${result.status} success=${result.success} components=${result.numberComponentsDeployed}/${result.numberComponentsTotal} errors=${result.numberComponentErrors}`);
    for (const f of failures) console.log(`  FAIL ${f.componentType} ${f.fullName}: ${f.problem}`);
    return result.success;
  }
}

async function main() {
  const auth = await token();
  const members = Object.keys(LAYOUTS);
  console.log(`SOAP Metadata API retrieve(): ${members.join(", ")}`);
  const zipBase64 = await retrieveLayouts(auth, members);

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "dentshift-layout-"));
  fs.writeFileSync(path.join(workDir, "retrieved.zip"), Buffer.from(zipBase64, "base64"));
  execFileSync("unzip", ["-q", "retrieved.zip"], { cwd: workDir });

  const layoutsDir = path.join(workDir, "unpackaged", "layouts");
  let anyChange = false;
  for (const [member, plan] of Object.entries(LAYOUTS)) {
    const file = path.join(layoutsDir, `${member}.layout`);
    if (!fs.existsSync(file)) {
      console.log(`${member}: ファイルが取得できませんでした(スキップ)`);
      continue;
    }
    let xml = fs.readFileSync(file, "utf8");
    const { missingFields, missingLists } = missingFor(xml, plan.fields, plan.relatedLists);
    console.log(`${member}: 追加項目${missingFields.length}件, 追加関連リスト${missingLists.length}件`);
    if (missingFields.length === 0 && missingLists.length === 0) continue;
    anyChange = true;
    // Layout型のXSDは要素の出現順序が固定されているため、ファイル末尾への単純追記では
    // 「Element layoutSections is duplicated at this location」のようなシーケンスエラーになる。
    // 新しいlayoutSectionsは既存の最後の</layoutSections>の直後、新しいrelatedListsは既存の
    // 最後の</relatedLists>の直後(relatedListsが無ければlayoutSectionsの直後)に挿入し、
    // 既存の要素順序を維持する。
    if (missingFields.length) {
      const sectionXml = buildSectionXml(missingFields);
      const lastSectionEnd = xml.lastIndexOf("</layoutSections>");
      if (lastSectionEnd === -1) throw new Error(`${member}: <layoutSections> が見つかりません(想定外のレイアウト構造)`);
      const insertAt = lastSectionEnd + "</layoutSections>".length;
      xml = xml.slice(0, insertAt) + "\n" + sectionXml + xml.slice(insertAt);
    }
    if (missingLists.length) {
      const listsXml = missingLists.map(buildRelatedListXml).join("\n");
      const lastListEnd = xml.lastIndexOf("</relatedLists>");
      const lastSectionEnd = xml.lastIndexOf("</layoutSections>");
      const insertAt = (lastListEnd !== -1 ? lastListEnd + "</relatedLists>".length : lastSectionEnd + "</layoutSections>".length);
      xml = xml.slice(0, insertAt) + "\n" + listsXml + xml.slice(insertAt);
    }
    fs.writeFileSync(file, xml);
  }

  if (!anyChange) {
    console.log("反映すべき差分はありません。");
    return;
  }

  const zipDir = fs.mkdtempSync(path.join(os.tmpdir(), "dentshift-layout-zip-"));
  execFileSync("zip", ["-qr", path.join(zipDir, "deploy.zip"), "."], { cwd: path.join(workDir, "unpackaged") });
  const zipBuffer = fs.readFileSync(path.join(zipDir, "deploy.zip"));

  console.log(apply ? "--- デプロイ(実反映) ---" : "--- 検証のみ(checkOnly) ---");
  const ok = await deployZip(auth, zipBuffer, !apply);
  if (!ok) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
