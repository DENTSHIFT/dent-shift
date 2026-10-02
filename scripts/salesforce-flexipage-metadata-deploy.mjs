#!/usr/bin/env node
/**
 * 既存のLightning レコードページ(FlexiPage)へ、「DENT SHIFT」タブ(項目セクション+関連リスト)を
 * 追加する。既存のタブ・項目セクション・クイックアクション等は一切変更・削除しない
 * (安全なメタデータ差分として、新しいFacet/タブだけを追記する)。
 *
 * 背景: このSandboxのAccount/Contact等のLightning レコードページは、クラシックのページレイアウトを
 * 動的に反映する「レコード詳細」コンポーネントではなく、個々の項目を手動配置した静的な
 * 「項目セクション」コンポーネントで構成されている。そのため、ページレイアウト側へ項目を
 * 追加しても(salesforce-layout-metadata-deploy.mjs)、この画面には自動反映されない。
 * Lightning App Builder(ビジュアルエディタ)でのドラッグ&ドロップ操作は、このSandboxの環境では
 * キー入力がキャンバスのショートカット(コンポーネント削除等)に誤って伝わる不具合が確認されており
 * (未保存の状態でのみ発生、実際の保存はしていない)、自動操作でのUI編集は行わない。
 *
 * 代わりに、salesforce-layout-metadata-deploy.mjs と同じ手法(SOAP Metadata API の retrieve() で
 * 既存のFlexiPage XMLをそのまま取得し、新しいFacet(項目セクション・関連リスト)と、それらを
 * 束ねる新しいタブだけを追記してREST Metadata API のdeployRequestへ戻す)で対応する。
 * FlexiPageのflexiPageRegions(Facet)は名前で参照される独立した要素であり、Layoutのような
 * 厳密な出現順序の制約が無いため、新しいFacetはファイル末尾に追記するだけでよい。
 * 唯一、新しいタブ自体は既存の「タブの集合」Facet(flexipage:tabsetが参照するFacet)の
 * 末尾に新しい<itemInstances>を追記する必要がある。
 *
 *   set -a; source salesforce/.env.sandbox-admin; set +a
 *   node scripts/salesforce-flexipage-metadata-deploy.mjs              # 検証のみ(retrieve+差分表示、deployはcheckOnly)
 *   node scripts/salesforce-flexipage-metadata-deploy.mjs --apply      # Sandboxへ反映
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

const fieldsOf = (object) =>
  spec.objects[object].fields
    .flatMap((f) => (f[0] === "@summary" ? spec.summary : [f]))
    .filter((f) => f[1] !== "Lookup")
    .map((f) => f[0]);

// 対象のFlexiPageごとに: 対象オブジェクト、追加する項目、関連リスト(relatedListApiNameは子リレーションのrelationshipName)。
// LeadはこのSandboxでは動的な「レコード詳細」コンポーネントのページのため対象外
// (クラシックのページレイアウト変更がそのまま画面に反映される。実機確認済み)。
const PAGES = {
  Account_Record_Page_Three_Column: {
    object: "Account",
    fields: fieldsOf("Account"),
    relatedLists: [
      { relatedListApiName: "DentShift_Diagnoses__r", label: "DENT SHIFT診断" },
      { relatedListApiName: "DentShift_Consultations__r", label: "DENT SHIFT相談予約" },
    ],
  },
  Contact_Record_Page_Three_Column: {
    object: "Contact",
    fields: fieldsOf("Contact"),
    relatedLists: [],
  },
  Opportunity_Record_Page_Three_Column: {
    object: "Opportunity",
    fields: fieldsOf("Opportunity"),
    relatedLists: [],
  },
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
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:met="http://soap.sforce.com/2006/04/metadata">
  <soapenv:Header><met:SessionHeader><met:sessionId>${auth.accessToken}</met:sessionId></met:SessionHeader></soapenv:Header>
  <soapenv:Body>${body}</soapenv:Body>
</soapenv:Envelope>`;
}

async function soapCall(auth, action, bodyXml) {
  const res = await fetch(`${auth.instanceUrl}/services/Soap/m/${API.slice(1)}`, {
    method: "POST",
    headers: { "Content-Type": "text/xml;charset=UTF-8", SOAPAction: action },
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

async function retrieveFlexiPages(auth, members) {
  const types = members.map((m) => `<met:types><met:members>${m}</met:members><met:name>FlexiPage</met:name></met:types>`).join("");
  const retrieveBody = `<met:retrieve><met:retrieveRequest><met:apiVersion>${API.slice(1)}</met:apiVersion><met:unpackaged>${types}<met:version>${API.slice(1)}</met:version></met:unpackaged></met:retrieveRequest></met:retrieve>`;
  const startRes = await soapCall(auth, "retrieve", retrieveBody);
  const asyncId = xmlTag(startRes, "id");
  if (!asyncId) throw new Error(`retrieve() did not return an id: ${startRes.slice(0, 800)}`);
  for (;;) {
    await new Promise((r) => setTimeout(r, 3000));
    const statusRes = await soapCall(auth, "checkRetrieveStatus", `<met:checkRetrieveStatus><met:asyncProcessId>${asyncId}</met:asyncProcessId><met:includeZip>true</met:includeZip></met:checkRetrieveStatus>`);
    if (xmlTag(statusRes, "done") !== "true") continue;
    if (xmlTag(statusRes, "success") !== "true") {
      const messages = [...statusRes.matchAll(/<messages>[\s\S]*?<problem>([^<]*)<\/problem>[\s\S]*?<\/messages>/g)].map((m) => m[1]);
      throw new Error(`retrieve failed: ${messages.join("; ") || statusRes.slice(0, 800)}`);
    }
    const zipBase64 = xmlTag(statusRes, "zipFile");
    if (!zipBase64) throw new Error(`checkRetrieveStatus returned success but no zipFile: ${statusRes.slice(0, 800)}`);
    return zipBase64;
  }
}

function uid() {
  return crypto.randomUUID();
}

function fieldInstancesFacet(name, fields) {
  const items = fields
    .map(
      (f) => `        <itemInstances>
            <fieldInstance>
                <fieldInstanceProperties>
                    <name>uiBehavior</name>
                    <value>none</value>
                </fieldInstanceProperties>
                <fieldItem>Record.${f}</fieldItem>
                <identifier>DentShift_${f}</identifier>
            </fieldInstance>
        </itemInstances>`
    )
    .join("\n");
  return `    <flexiPageRegions>
${items}
        <name>${name}</name>
        <type>Facet</type>
    </flexiPageRegions>`;
}

function columnFacet(name, columnDefs) {
  const items = columnDefs
    .map(
      (bodyFacetName, i) => `        <itemInstances>
            <componentInstance>
                <componentInstanceProperties>
                    <name>body</name>
                    <value>${bodyFacetName}</value>
                </componentInstanceProperties>
                <componentName>flexipage:column</componentName>
                <identifier>DentShift_column${i + 1}</identifier>
            </componentInstance>
        </itemInstances>`
    )
    .join("\n");
  return `    <flexiPageRegions>
${items}
        <name>${name}</name>
        <type>Facet</type>
    </flexiPageRegions>`;
}

function fieldSectionRelatedListsFacet(name, fieldSectionColumnsFacetName, relatedLists, object) {
  const relatedListItems = relatedLists
    .map(
      (r, i) => `        <itemInstances>
            <componentInstance>
                <componentInstanceProperties>
                    <name>parentFieldApiName</name>
                    <value>${object}.Id</value>
                </componentInstanceProperties>
                <componentInstanceProperties>
                    <name>relatedListApiName</name>
                    <value>${r.relatedListApiName}</value>
                </componentInstanceProperties>
                <componentInstanceProperties>
                    <name>relatedListComponentOverride</name>
                    <value>NONE</value>
                </componentInstanceProperties>
                <componentInstanceProperties>
                    <name>rowsToDisplay</name>
                    <value>10</value>
                </componentInstanceProperties>
                <componentInstanceProperties>
                    <name>showActionBar</name>
                    <value>true</value>
                </componentInstanceProperties>
                <componentName>force:relatedListSingleContainer</componentName>
                <identifier>DentShift_relatedList${i + 1}</identifier>
            </componentInstance>
        </itemInstances>`
    )
    .join("\n");
  return `    <flexiPageRegions>
        <itemInstances>
            <componentInstance>
                <componentInstanceProperties>
                    <name>columns</name>
                    <value>${fieldSectionColumnsFacetName}</value>
                </componentInstanceProperties>
                <componentInstanceProperties>
                    <name>horizontalAlignment</name>
                    <value>false</value>
                </componentInstanceProperties>
                <componentInstanceProperties>
                    <name>label</name>
                    <value>DENT SHIFT</value>
                </componentInstanceProperties>
                <componentName>flexipage:fieldSection</componentName>
                <identifier>DentShift_fieldSection</identifier>
            </componentInstance>
        </itemInstances>
${relatedListItems}
        <name>${name}</name>
        <type>Facet</type>
    </flexiPageRegions>`;
}

function missingFieldsFor(xml, fields) {
  const present = new Set([...xml.matchAll(/<fieldItem>Record\.([^<]+)<\/fieldItem>/g)].map((m) => m[1]));
  return fields.filter((f) => !present.has(f));
}

function missingRelatedListsFor(xml, relatedLists) {
  const present = new Set([...xml.matchAll(/<name>relatedListApiName<\/name>\s*<value>([^<]+)<\/value>/g)].map((m) => m[1]));
  return relatedLists.filter((r) => !present.has(r.relatedListApiName));
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
  const members = Object.keys(PAGES);
  console.log(`SOAP Metadata API retrieve(): ${members.join(", ")}`);
  const zipBase64 = await retrieveFlexiPages(auth, members);

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "dentshift-flexipage-"));
  fs.writeFileSync(path.join(workDir, "retrieved.zip"), Buffer.from(zipBase64, "base64"));
  execFileSync("unzip", ["-q", "retrieved.zip"], { cwd: workDir });

  const pagesDir = path.join(workDir, "unpackaged", "flexipages");
  let anyChange = false;
  for (const [member, plan] of Object.entries(PAGES)) {
    const file = path.join(pagesDir, `${member}.flexipage`);
    if (!fs.existsSync(file)) {
      console.log(`${member}: ファイルが取得できませんでした(スキップ)`);
      continue;
    }
    let xml = fs.readFileSync(file, "utf8");
    const missingFields = missingFieldsFor(xml, plan.fields);
    const missingLists = missingRelatedListsFor(xml, plan.relatedLists);
    console.log(`${member}: 追加項目${missingFields.length}件, 追加関連リスト${missingLists.length}件`);
    if (missingFields.length === 0 && missingLists.length === 0) continue;

    // 既存のタブ集合Facet(flexipage:tabsetのtabsプロパティが指す名前)を特定する。
    const tabsetMatch = xml.match(/<name>tabs<\/name>\s*<value>([^<]+)<\/value>\s*<\/componentInstanceProperties>\s*<componentName>flexipage:tabset<\/componentName>/);
    if (!tabsetMatch) throw new Error(`${member}: flexipage:tabset のtabsプロパティが見つかりません(想定外の構造)`);
    const tabsFacetName = tabsetMatch[1];

    const half = Math.ceil(missingFields.length / 2);
    const leftFacetName = `Facet-DentShift-${uid()}`;
    const rightFacetName = `Facet-DentShift-${uid()}`;
    const columnsFacetName = `Facet-DentShift-${uid()}`;
    const tabBodyFacetName = `Facet-DentShift-${uid()}`;

    const additions = [];
    if (missingFields.length) {
      additions.push(fieldInstancesFacet(leftFacetName, missingFields.slice(0, half)));
      if (missingFields.slice(half).length) additions.push(fieldInstancesFacet(rightFacetName, missingFields.slice(half)));
      const columnList = missingFields.slice(half).length ? [leftFacetName, rightFacetName] : [leftFacetName];
      additions.push(columnFacet(columnsFacetName, columnList));
    }
    additions.push(
      fieldSectionRelatedListsFacet(
        tabBodyFacetName,
        columnsFacetName,
        missingLists.length ? missingLists : plan.relatedLists.filter((r) => !missingLists.includes(r)),
        plan.object
      )
    );
    // 新しいDENT SHIFTタブ自体を追記する(関連リストのみ不足している場合も、項目セクション自体は
    // 既存のタブに既に存在しないため、常に新規タブとして追加する)。
    const newTabXml = `        <itemInstances>
            <componentInstance>
                <componentInstanceProperties>
                    <name>body</name>
                    <value>${tabBodyFacetName}</value>
                </componentInstanceProperties>
                <componentInstanceProperties>
                    <name>title</name>
                    <value>DENT SHIFT</value>
                </componentInstanceProperties>
                <componentName>flexipage:tab</componentName>
                <identifier>DentShift_tab</identifier>
            </componentInstance>
        </itemInstances>`;

    // 1. 新しいFacet群を追記する。FlexiPageのXSDはflexiPageRegions(Facet/Region)群の後に
    //    masterLabel/sobjectType/template/type等が続く順序を要求するため、単純にファイル末尾
    //    (</FlexiPage>の直前)へ追記すると「Element flexiPageRegions is duplicated at this
    //    location」になる。既存の最後の</flexiPageRegions>の直後(<masterLabel>の直前)に挿入する。
    const lastRegionEnd = xml.lastIndexOf("</flexiPageRegions>");
    if (lastRegionEnd === -1) throw new Error(`${member}: <flexiPageRegions> が見つかりません(想定外の構造)`);
    const insertAt = lastRegionEnd + "</flexiPageRegions>".length;
    xml = xml.slice(0, insertAt) + "\n" + additions.join("\n") + xml.slice(insertAt);
    // 2. 新しいタブを、既存のタブ集合Facetの最後の<itemInstances>の直後に追記する
    //    (そのFacetブロック内で最後に出現する</itemInstances>を探す)。
    const tabsFacetBlockRe = new RegExp(`(<flexiPageRegions>[\\s\\S]*?<name>${tabsFacetName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}<\\/name>\\s*<type>Facet<\\/type>\\s*<\\/flexiPageRegions>)`);
    const blockMatch = xml.match(tabsFacetBlockRe);
    if (!blockMatch) throw new Error(`${member}: タブ集合Facet(${tabsFacetName})のブロックが見つかりません`);
    const originalBlock = blockMatch[1];
    const lastItemEnd = originalBlock.lastIndexOf("</itemInstances>") + "</itemInstances>".length;
    const updatedBlock = originalBlock.slice(0, lastItemEnd) + "\n" + newTabXml + originalBlock.slice(lastItemEnd);
    xml = xml.replace(originalBlock, updatedBlock);

    fs.writeFileSync(file, xml);
    anyChange = true;
  }

  if (!anyChange) {
    console.log("反映すべき差分はありません。");
    return;
  }

  const zipDir = fs.mkdtempSync(path.join(os.tmpdir(), "dentshift-flexipage-zip-"));
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
