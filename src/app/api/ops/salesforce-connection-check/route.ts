import { NextResponse } from "next/server";
import { getCurrentOperator } from "@/server/auth/operatorSession";
import { recordAuditLog } from "@/server/db/auditLogRepository";
import { resolveSalesforceConfigFromProcessEnv } from "@/server/config/salesforceConfig";
import {
  getSalesforceRecordByExternalId,
  SalesforceDeliveryError,
  ORG_MISMATCH_ERROR_CODE,
  OAUTH_ERROR_CODE,
} from "@/server/providers/salesforce/salesforceClient";

/**
 * ops専用・管理者限定: デプロイ環境のSALESFORCE_*認証情報で、実際にOAuth接続できるか・
 * 接続先組織がSALESFORCE_EXPECTED_ORG_IDと一致するかだけを確認する、書き込みを伴わない
 * 診断エンドポイント(2026-10-02追加、PO指示: 同期有効化前に実行環境の接続先を確認)。
 * 存在しないLead外部IDで1件読み取りを試みるだけで、作成・更新・削除は一切行わない。
 * アクセストークン・組織ID・接続先URLの値そのものはレスポンス・ログへ一切出さず、
 * 「一致したか/しなかったか」の真偽値のみを返す。
 */
export async function GET() {
  const operator = await getCurrentOperator();
  if (!operator) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }
  if (operator.role !== "admin") {
    return NextResponse.json({ error: "この操作には管理者権限が必要です" }, { status: 403 });
  }

  let config;
  try {
    config = resolveSalesforceConfigFromProcessEnv();
  } catch (error) {
    return NextResponse.json({
      provider: "disabled-or-misconfigured",
      error: error instanceof Error ? error.message : "unknown config error",
    });
  }
  if (config.provider !== "salesforce") {
    return NextResponse.json({ provider: "disabled" });
  }

  const result = {
    provider: "salesforce" as const,
    loginUrlIsSandboxHost: /--[^.]+\.sandbox\./.test(new URL(config.loginUrl).host),
    connected: false,
    orgIdMatches: false,
    errorCode: null as string | null,
  };

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

  return NextResponse.json(result);
}
