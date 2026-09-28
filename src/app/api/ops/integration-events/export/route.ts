import { NextResponse } from "next/server";
import { getCurrentOperator } from "@/server/auth/operatorSession";
import { prisma } from "@/server/db/prismaClient";
import { recordAuditLog } from "@/server/db/auditLogRepository";

/**
 * /ops/integration-events のCSV出力(2026-09-29追加・09-29改修、PO承認、Salesforce連携P0)。
 * 未同期・失敗分(status in ["pending","failed"])のみを対象とし、Salesforce自動同期が
 * 何らかの理由で完了していないリードを、Salesforceへ手動インポートできる形で救出する。
 *
 * PO再指摘(2026-09-29)への対応:
 * - 通常のops一覧画面は引き続きPIIをマスクして表示する(redactIntegrationEventPayloadForOps、
 *   page.tsx側は変更していない)。このCSVエンドポイントだけ、Salesforce取り込みに必要な
 *   実値を出力する(そもそも実値でなければSalesforceへ取り込めないため)。
 * - 権限: role==="admin"のOperatorのみ許可する(cs/analyst/financeは403)。
 * - 出力列: Salesforce Leadインポートに必要な最小限の固定列のみ(payload全体のJSON blobを
 *   丸ごと出力しない)。
 * - 監査: 実行者Operator ID・実行日時・出力件数をPIIなしでAuditLogへ記録する
 *   (メールアドレス等の値そのものは記録しない)。
 * - キャッシュ: Cache-Control: no-storeでブラウザ・CDNキャッシュを禁止する。
 * - CSVインジェクション対策: 値が(前後の空白を除いた上で)=,+,-,@ で始まる場合、
 *   単なる引用符囲みだけに頼らず、セル内容の先頭にシングルクォートを付与してから
 *   ダブルクォートで囲む(スプレッドシートソフトに文字列として認識させ、数式評価による
 *   コマンド実行を防ぐ、OWASP CSV Injection対策)。
 * - パスワード・トークン・OTP・カード情報は出力対象の列に含めない(固定列方式のため
 *   混入の余地がない)。
 * - ログ: このレスポンスの内容・値をアプリケーションログへ出力しない。
 */

const CSV_INJECTION_TRIGGER_PATTERN = /^[=+\-@]/;

function escapeCsvCell(value: string): string {
  const leadingTrimmed = value.replace(/^[\s　]+/, "");
  const triggersFormula = CSV_INJECTION_TRIGGER_PATTERN.test(leadingTrimmed);
  const neutralized = triggersFormula ? `'${value}` : value;
  return `"${neutralized.replace(/"/g, '""')}"`;
}

function formatDateTime(value: Date | null | undefined): string {
  if (!value) return "";
  return value.toISOString();
}

function readStringField(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

// Salesforce Leadインポートに必要な最小限の列のみを固定で出力する(payload全体を
// ダンプしない)。ここに無いキーはCSVへ一切出力されない。
const CSV_COLUMNS = [
  "event_id",
  "event_type",
  "status",
  "last_error",
  "created_at",
  "last_attempted_at",
  "next_retry_at",
  "clinic_id",
  "contact_id",
  "email",
  "clinic_name",
  "director_name",
  "phone",
  "website_url",
  "plan",
  "contract_status",
  "consent_accepted_at",
  "consultation_requested",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
] as const;

export async function GET() {
  const operator = await getCurrentOperator();
  if (!operator) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }
  // 2026-09-29追加(PO再指摘): Salesforce取り込み用の実値CSVは、権限を持つ運用管理者
  // (admin)だけに限定する(cs/analyst/financeは一覧の伏字表示のみ利用可能)。
  if (operator.role !== "admin") {
    return NextResponse.json({ error: "この操作には管理者権限が必要です" }, { status: 403 });
  }

  const events = await prisma.integrationEvent.findMany({
    where: { status: { in: ["pending", "failed"] } },
    orderBy: { createdAt: "desc" },
  });

  const rows = events.map((event) => {
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(event.payloadJson) as Record<string, unknown>;
    } catch {
      payload = {};
    }
    const contractStatus =
      readStringField(payload, "to_status") || readStringField(payload, "status");
    return [
      event.id,
      event.eventType,
      event.status,
      event.lastError ?? "",
      formatDateTime(event.createdAt),
      formatDateTime(event.lastAttemptedAt),
      formatDateTime(event.nextRetryAt),
      event.clinicId ?? "",
      event.contactId ?? readStringField(payload, "contact_id"),
      readStringField(payload, "email"),
      readStringField(payload, "clinic_name"),
      readStringField(payload, "director_name"),
      readStringField(payload, "phone"),
      readStringField(payload, "website_url"),
      readStringField(payload, "plan"),
      contractStatus,
      readStringField(payload, "consent_accepted_at"),
      readStringField(payload, "consultation_requested"),
      readStringField(payload, "utm_source"),
      readStringField(payload, "utm_medium"),
      readStringField(payload, "utm_campaign"),
      readStringField(payload, "utm_content"),
      readStringField(payload, "utm_term"),
    ];
  });

  const csvBody = [[...CSV_COLUMNS], ...rows]
    .map((row) => row.map(escapeCsvCell).join(","))
    .join("\r\n");
  // Excel/日本語文字化け対策のUTF-8 BOM。
  const csvWithBom = "﻿" + csvBody;

  // 2026-09-29追加(PO再指摘): 実値を含むCSVのダウンロード実行を、値そのものを含めずに
  // 監査ログへ記録する(実行者Operator ID・日時・件数のみ。メールアドレス等は含めない)。
  await recordAuditLog({
    operatorId: operator.id,
    action: "integration_events.export_csv",
    targetType: "IntegrationEvent",
    metadata: { exportedCount: events.length },
  });

  return new NextResponse(csvWithBom, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="integration-events-unsynced.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
