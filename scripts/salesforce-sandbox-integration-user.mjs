#!/usr/bin/env node
/**
 * Sandbox専用の連携ユーザーを作成し、最小権限を割り当てる(Sandbox以外では停止)。
 *   ライセンス: Salesforce Integration / プロファイル: Minimum Access - API Only Integrations
 *   権限セットライセンス: Salesforce API Integration / 権限セット: DentShift_Integration
 * 既に存在する場合は作成せず、不足している割り当てだけを追加する(何度実行しても同じ結果)。
 *
 *   set -a; source salesforce/.env.sandbox; set +a
 *   node scripts/salesforce-sandbox-integration-user.mjs            # ドライラン(現状と予定を表示)
 *   node scripts/salesforce-sandbox-integration-user.mjs --apply    # 作成・割り当て
 *
 * 接続アプリの「実行ユーザー」をこのユーザーへ切り替える操作は、Sandboxの設定画面で行う(手順書参照)。
 */
const API = "v60.0";
const apply = process.argv.includes("--apply");
const USERNAME = process.env.SANDBOX_INTEGRATION_USERNAME?.trim() || "dentshift.sync@mcollection-japan.jp.dsverify";

function env(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`環境変数 ${name} が必要です。`);
  return value;
}

async function main() {
  const res = await fetch(`${new URL(env("SALESFORCE_LOGIN_URL")).origin}/services/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: env("SALESFORCE_CLIENT_ID"), client_secret: env("SALESFORCE_CLIENT_SECRET") }),
  });
  if (!res.ok) throw new Error(`OAuth failed: HTTP ${res.status}`);
  const tok = await res.json();
  if (tok.id.split("/id/")[1].split("/")[0].slice(0, 15) !== env("SALESFORCE_EXPECTED_ORG_ID").slice(0, 15)) {
    throw new Error("接続先の組織IDが SALESFORCE_EXPECTED_ORG_ID と一致しません。");
  }
  const call = async (p, init = {}) => {
    const r = await fetch(`${tok.instance_url}/services/data/${API}${p}`, {
      ...init,
      headers: { Authorization: `Bearer ${tok.access_token}`, "Content-Type": "application/json" },
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`${init.method ?? "GET"} ${p.split("?")[0]}: HTTP ${r.status} ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  };
  const q = async (soql) => (await call(`/query?q=${encodeURIComponent(soql)}`)).records;

  const [org] = await q("SELECT IsSandbox FROM Organization");
  if (!org.IsSandbox) throw new Error("接続先がSandboxではありません。本番組織では実行しません。");

  const [profile] = await q("SELECT Id FROM Profile WHERE Name = 'Minimum Access - API Only Integrations'");
  const [psl] = await q("SELECT Id, TotalLicenses, UsedLicenses FROM PermissionSetLicense WHERE DeveloperName = 'SalesforceAPIIntegrationPsl'");
  const [permissionSet] = await q("SELECT Id FROM PermissionSet WHERE Name = 'DentShift_Integration'");
  if (!profile || !psl) throw new Error("連携ユーザー用のプロファイルまたは権限セットライセンスが見つかりません。");
  if (!permissionSet) throw new Error("権限セット DentShift_Integration がありません。先にメタデータを反映してください。");

  let [user] = await q(`SELECT Id, IsActive FROM User WHERE Username = '${USERNAME.replace(/'/g, "")}'`);
  console.log(`user: ${user ? "既存" : "未作成"} / 権限セットライセンス残り: ${psl.TotalLicenses - psl.UsedLicenses}`);
  if (!apply) return;

  if (!user) {
    const created = await call("/sobjects/User", {
      method: "POST",
      body: JSON.stringify({
        Username: USERNAME,
        Email: env("SANDBOX_INTEGRATION_USER_EMAIL"),
        LastName: "DENT SHIFT 連携(Sandbox)",
        Alias: "dssync",
        ProfileId: profile.Id,
        TimeZoneSidKey: "Asia/Tokyo",
        LocaleSidKey: "ja_JP",
        LanguageLocaleKey: "ja",
        EmailEncodingKey: "UTF-8",
      }),
    });
    user = { Id: created.id, IsActive: true };
    console.log("created integration user");
  }
  const hasPsl = (await q(`SELECT Id FROM PermissionSetLicenseAssign WHERE AssigneeId = '${user.Id}' AND PermissionSetLicenseId = '${psl.Id}'`)).length > 0;
  if (!hasPsl) {
    await call("/sobjects/PermissionSetLicenseAssign", { method: "POST", body: JSON.stringify({ AssigneeId: user.Id, PermissionSetLicenseId: psl.Id }) });
    console.log("assigned permission set license");
  }
  const hasPs = (await q(`SELECT Id FROM PermissionSetAssignment WHERE AssigneeId = '${user.Id}' AND PermissionSetId = '${permissionSet.Id}'`)).length > 0;
  if (!hasPs) {
    await call("/sobjects/PermissionSetAssignment", { method: "POST", body: JSON.stringify({ AssigneeId: user.Id, PermissionSetId: permissionSet.Id }) });
    console.log("assigned DentShift_Integration");
  }
  console.log("done. 次に、Sandboxの外部クライアントアプリの実行ユーザーをこのユーザーへ切り替えてください。");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
