import { NextResponse } from "next/server";
import { getCurrentOperator } from "@/server/auth/operatorSession";
import { prisma } from "@/server/db/prismaClient";
import { redactIntegrationEventPayloadForOps } from "@/domain/integration/events";

/**
 * /ops/integration-events のCSV出力(2026-09-29追加、PO承認、Salesforce連携P0)。
 * 未同期・失敗分(status in ["pending","failed"])のみを対象とし、Salesforce自動同期が
 * 何らかの理由で完了していないリードを、運営者が手動でフォローできるようにする。
 *
 * - 認証: getCurrentOperator()必須(既存/api/ops配下と同じ規約。未ログインは401 JSON)。
 * - CSVインジェクション対策: セル値が =,+,-,@ で始まる場合、先頭にシングルクォートを付与し
 *   スプレッドシートソフトによる数式・コマンド実行を防ぐ(OWASP CSV Injection対策)。
 * - PII保護: payloadJsonはredactIntegrationEventPayloadForOps()でマスクした上で出力する
 *   (既存opsのブラウザ表示と同じマスク基準)。アクセスログ・エラーログには行内容を出さない。
 */

const CSV_INJECTION_PREFIX_PATTERN = /^[=+\-@]/;

function escapeCsvCell(value: string): string {
  const safeValue = CSV_INJECTION_PREFIX_PATTERN.test(value) ? `'${value}` : value;
  return `"${safeValue.replace(/"/g, '""')}"`;
}

function formatDateTime(value: Date | null | undefined): string {
  if (!value) return "";
  return value.toISOString();
}

export async function GET() {
  const operator = await getCurrentOperator();
  if (!operator) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }

  const events = await prisma.integrationEvent.findMany({
    where: { status: { in: ["pending", "failed"] } },
    orderBy: { createdAt: "desc" },
  });

  const header = [
    "id",
    "eventType",
    "status",
    "retryCount",
    "lastError",
    "clinicId",
    "contactId",
    "createdAt",
    "lastAttemptedAt",
    "nextRetryAt",
    "payload",
  ];

  const rows = events.map((event) => {
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(event.payloadJson) as Record<string, unknown>;
    } catch {
      payload = {};
    }
    const redactedPayload = redactIntegrationEventPayloadForOps(payload);
    return [
      event.id,
      event.eventType,
      event.status,
      String(event.retryCount),
      event.lastError ?? "",
      event.clinicId ?? "",
      event.contactId ?? "",
      formatDateTime(event.createdAt),
      formatDateTime(event.lastAttemptedAt),
      formatDateTime(event.nextRetryAt),
      JSON.stringify(redactedPayload),
    ];
  });

  const csvBody = [header, ...rows]
    .map((row) => row.map(escapeCsvCell).join(","))
    .join("\r\n");
  // Excel/日本語文字化け対策のUTF-8 BOM。
  const csvWithBom = "﻿" + csvBody;

  return new NextResponse(csvWithBom, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="integration-events-unsynced.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
