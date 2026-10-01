#!/usr/bin/env node
/**
 * salesforce/force-app のメタデータ(連携用の項目・カスタムオブジェクト・権限セット)を
 * Metadata REST API(deployRequest)でSalesforceへ反映する。Salesforce CLIは不要。
 *
 * 既定は検証のみ(checkOnly): 組織には何も反映されない。実反映は --deploy、取り消しは --rollback。
 * 接続先は .env ではなく実行時の環境変数(SALESFORCE_CLIENT_ID / SALESFORCE_CLIENT_SECRET /
 * SALESFORCE_LOGIN_URL / SALESFORCE_EXPECTED_ORG_ID)で指定し、組織IDが一致しない場合は中断する。
 *
 *   node scripts/salesforce-metadata-deploy.mjs              # 検証のみ(推奨: 最初に実行)
 *   node scripts/salesforce-metadata-deploy.mjs --deploy     # 反映(承認後)
 *   node scripts/salesforce-metadata-deploy.mjs --rollback   # 追加した項目・オブジェクト・権限セットを削除(承認後。項目のデータも消える)
 *   node scripts/salesforce-metadata-deploy.mjs --deploy --assign-permission-set   # 反映後、連携ユーザーへ権限セットを割り当て
 *
 * 出力には認証情報・レコード値を含めない。
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SRC = path.join(ROOT, "salesforce", "force-app", "main", "default");
const API = "v60.0";
const mode = process.argv.includes("--rollback") ? "rollback" : process.argv.includes("--deploy") ? "deploy" : "check";
const assignPermissionSet = process.argv.includes("--assign-permission-set");

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`環境変数 ${name} が必要です。`);
    process.exit(1);
  }
  return value;
}

function inner(xml, rootTag) {
  return xml.replace(/^<\?xml[^>]*>\s*/, "").replace(new RegExp(`^<${rootTag}[^>]*>`), "").replace(new RegExp(`</${rootTag}>\\s*$`), "").trim();
}

// ソース形式(objects/<Obj>/fields/*.field-meta.xml)をMetadata API形式(objects/<Obj>.object)へ変換する。
function buildMdapiDir() {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "dentshift-sf-"));
  const members = { CustomField: [], CustomObject: [], PermissionSet: [] };
  fs.mkdirSync(path.join(out, "objects"));
  for (const obj of fs.readdirSync(path.join(SRC, "objects"))) {
    const dir = path.join(SRC, "objects", obj);
    const objectFile = path.join(dir, `${obj}.object-meta.xml`);
    const parts = [];
    if (fs.existsSync(objectFile)) {
      parts.push(inner(fs.readFileSync(objectFile, "utf8"), "CustomObject"));
      members.CustomObject.push(obj);
    }
    for (const file of fs.readdirSync(path.join(dir, "fields")).sort()) {
      const xml = inner(fs.readFileSync(path.join(dir, "fields", file), "utf8"), "CustomField");
      parts.push(`<fields>\n${xml}\n</fields>`);
      members.CustomField.push(`${obj}.${file.replace(".field-meta.xml", "")}`);
    }
    fs.writeFileSync(
      path.join(out, "objects", `${obj}.object`),
      `<?xml version="1.0" encoding="UTF-8"?>\n<CustomObject xmlns="http://soap.sforce.com/2006/04/metadata">\n${parts.join("\n")}\n</CustomObject>\n`
    );
  }
  fs.mkdirSync(path.join(out, "permissionsets"));
  for (const file of fs.readdirSync(path.join(SRC, "permissionsets"))) {
    const name = file.replace(".permissionset-meta.xml", "");
    fs.copyFileSync(path.join(SRC, "permissionsets", file), path.join(out, "permissionsets", `${name}.permissionset`));
    members.PermissionSet.push(name);
  }
  return { out, members };
}

function packageXml(members) {
  const types = Object.entries(members)
    .filter(([, list]) => list.length)
    .map(([type, list]) => `  <types>\n${list.map((m) => `    <members>${m}</members>`).join("\n")}\n    <name>${type}</name>\n  </types>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Package xmlns="http://soap.sforce.com/2006/04/metadata">\n${types}\n  <version>${API.slice(1)}</version>\n</Package>\n`;
}

async function token() {
  const loginUrl = new URL(requireEnv("SALESFORCE_LOGIN_URL")).origin;
  const res = await fetch(`${loginUrl}/services/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: requireEnv("SALESFORCE_CLIENT_ID"),
      client_secret: requireEnv("SALESFORCE_CLIENT_SECRET"),
    }),
  });
  if (!res.ok) throw new Error(`OAuth token request failed: HTTP ${res.status}`);
  const body = await res.json();
  const orgId = String(body.id ?? "").split("/id/")[1]?.split("/")[0] ?? "";
  const userId = String(body.id ?? "").split("/").pop();
  if (orgId.slice(0, 15) !== requireEnv("SALESFORCE_EXPECTED_ORG_ID").slice(0, 15)) {
    throw new Error("接続先の組織IDが SALESFORCE_EXPECTED_ORG_ID と一致しません。中断します。");
  }
  return { accessToken: body.access_token, instanceUrl: body.instance_url, userId };
}

async function deployZip(auth, zipPath, checkOnly) {
  const form = new FormData();
  form.append(
    "json",
    new Blob([JSON.stringify({ deployOptions: { checkOnly, singlePackage: true, rollbackOnError: true, testLevel: "NoTestRun" } })], {
      type: "application/json",
    })
  );
  form.append("file", new Blob([fs.readFileSync(zipPath)], { type: "application/zip" }), "deploy.zip");
  const res = await fetch(`${auth.instanceUrl}/services/data/${API}/metadata/deployRequest`, {
    method: "POST",
    headers: { Authorization: `Bearer ${auth.accessToken}` },
    body: form,
  });
  if (!res.ok) throw new Error(`deployRequest failed: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  const { id } = await res.json();
  for (;;) {
    await new Promise((r) => setTimeout(r, 3000));
    const poll = await fetch(`${auth.instanceUrl}/services/data/${API}/metadata/deployRequest/${id}?includeDetails=true`, {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
    });
    const result = (await poll.json()).deployResult;
    if (!result?.done) continue;
    const failures = [result.details?.componentFailures ?? []].flat();
    console.log(`status=${result.status} success=${result.success} components=${result.numberComponentsDeployed}/${result.numberComponentsTotal} errors=${result.numberComponentErrors}`);
    for (const f of failures) console.log(`  FAIL ${f.componentType} ${f.fullName}: ${f.problem}`);
    return result.success;
  }
}

async function main() {
  const { out, members } = buildMdapiDir();
  const zipDir = fs.mkdtempSync(path.join(os.tmpdir(), "dentshift-sf-zip-"));
  if (mode === "rollback") {
    // 項目→オブジェクト→権限セットの依存関係は destructiveChangesPost でまとめて削除する。
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "dentshift-sf-rb-"));
    fs.writeFileSync(path.join(empty, "package.xml"), packageXml({}));
    const standardFields = members.CustomField.filter((f) => !members.CustomObject.includes(f.split(".")[0]));
    fs.writeFileSync(
      path.join(empty, "destructiveChangesPost.xml"),
      packageXml({ CustomField: standardFields, CustomObject: members.CustomObject, PermissionSet: members.PermissionSet })
    );
    execFileSync("zip", ["-qr", path.join(zipDir, "deploy.zip"), "."], { cwd: empty });
  } else {
    fs.writeFileSync(path.join(out, "package.xml"), packageXml(members));
    execFileSync("zip", ["-qr", path.join(zipDir, "deploy.zip"), "."], { cwd: out });
  }
  console.log(`mode=${mode} fields=${members.CustomField.length} objects=${members.CustomObject.length} permissionSets=${members.PermissionSet.length}`);

  const auth = await token();
  const ok = await deployZip(auth, path.join(zipDir, "deploy.zip"), mode === "check");
  if (!ok) process.exit(1);

  if (mode === "deploy" && assignPermissionSet) {
    const q = await fetch(
      `${auth.instanceUrl}/services/data/${API}/query?q=${encodeURIComponent("SELECT Id FROM PermissionSet WHERE Name = 'DentShift_Integration'")}`,
      { headers: { Authorization: `Bearer ${auth.accessToken}` } }
    ).then((r) => r.json());
    const permissionSetId = q.records?.[0]?.Id;
    const res = await fetch(`${auth.instanceUrl}/services/data/${API}/sobjects/PermissionSetAssignment`, {
      method: "POST",
      headers: { Authorization: `Bearer ${auth.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ AssigneeId: auth.userId, PermissionSetId: permissionSetId }),
    });
    const text = await res.text();
    console.log(res.ok || text.includes("DUPLICATE_VALUE") ? "permission set assigned to integration user" : `assignment failed: HTTP ${res.status}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
