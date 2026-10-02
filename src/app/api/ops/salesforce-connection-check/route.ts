import { NextResponse } from "next/server";
import { getCurrentOperator } from "@/server/auth/operatorSession";
import { recordAuditLog } from "@/server/db/auditLogRepository";
import { parseSalesforceCredentialsForDiagnosticsOnly, SalesforceConfigError } from "@/server/config/salesforceConfig";
import {
  getSalesforceRecordByExternalId,
  clearSalesforceTokenCacheForTests,
  SalesforceDeliveryError,
  ORG_MISMATCH_ERROR_CODE,
  OAUTH_ERROR_CODE,
} from "@/server/providers/salesforce/salesforceClient";

/**
 * ops専用・管理者限定: SALESFORCE_PROVIDERが"disabled"のままでも、設定済みの
 * SALESFORCE_*資格情報で実際にOAuth接続できるか・接続先組織がSALESFORCE_EXPECTED_ORG_IDと
 * 一致するか・Sandboxのホスト名規則に合致するかだけを確認する、書き込みを伴わない診断
 * エンドポイント(2026-10-02追加、PO指示: 通常の同期処理を呼ばず、同期有効化より前の段階で
 * 接続先を確認できるようにする)。
 *
 * - resolveSalesforceConfig()(通常の同期経路)は一切呼ばない。provider gateを迂回する
 *   parseSalesforceCredentialsForDiagnosticsOnly()だけを使うため、このエンドポイントの
 *   呼び出し自体がSalesforceへの同期を有効化したり、保留中イベントを処理したりすることはない。
 * - 存在しないLead外部IDで1件読み取りを試みるだけで、作成・更新・削除は一切行わない。
 * - 毎回clearSalesforceTokenCacheForTests()でトークンキャッシュを捨ててから接続するため、
 *   古い接続先の結果をキャッシュから返すことはない(名前はテスト用だが、ここでは
 *   「キャッシュ禁止」の実装手段として意図的に再利用している)。
 * - アクセストークン・組織ID・接続先URLの値そのものはレスポンス・ログへ一切出さず、
 *   「一致したか/しなかったか」の真偽値のみを返す。
 */
export async function GET() {
  const noStore = { headers: { "Cache-Control": "no-store" } };
  const operator = await getCurrentOperator();
  if (!operator) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401, ...noStore });
  }
  if (operator.role !== "admin") {
    return NextResponse.json({ error: "この操作には管理者権限が必要です" }, { status: 403, ...noStore });
  }

  let config;
  try {
    config = parseSalesforceCredentialsForDiagnosticsOnly({ env: process.env });
  } catch (error) {
    const message = error instanceof SalesforceConfigError ? error.message : "unknown config error";
    return NextResponse.json({ credentialsConfigured: false, error: message }, noStore);
  }

  const result = {
    credentialsConfigured: true as const,
    loginUrlIsSandboxHost: /--[^.]+\.sandbox\./.test(new URL(config.loginUrl).host),
    connected: false,
    orgIdMatches: false,
    errorCode: null as string | null,
  };

  clearSalesforceTokenCacheForTests();

  try {
    await getSalesforceRecordByExternalId({
      config,
      sobject: "Lead",
      externalIdField: "DentShift_Clinic_Id__c",
      externalId: "__dentshift_connection_check__",
      fields: [],
    });
    result.connected = true;
    result.orgIdMatches = true;
  } catch (error) {
    if (error instanceof SalesforceDeliveryError) {
      result.errorCode = error.errorCode;
      if (error.errorCode !== ORG_MISMATCH_ERROR_CODE && error.errorCode !== OAUTH_ERROR_CODE) {
        // OAuth自体・組織照合は成功し、読み取りクエリ自体のエラー(項目不足等)だけが起きた場合。
        result.connected = true;
        result.orgIdMatches = true;
      }
    } else {
      result.errorCode = "UNKNOWN";
    }
  }

  await recordAuditLog({
    operatorId: operator.id,
    action: "ops_salesforce_connection_check",
    targetType: "SalesforceConnection",
    metadata: { connected: result.connected, orgIdMatches: result.orgIdMatches, errorCode: result.errorCode },
  }).catch((error) => {
    console.error("[ops/salesforce-connection-check] audit log recording failed:", error);
  });

  return NextResponse.json(result, noStore);
}
