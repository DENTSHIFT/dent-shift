import { NextRequest, NextResponse } from "next/server";
import { getCurrentOperator } from "@/server/auth/operatorSession";
import { recordAuditLog } from "@/server/db/auditLogRepository";
import {
  countIntegrationEventsForOps,
  reenqueueFailedIntegrationEventsBulk,
  OPS_BULK_REENQUEUE_LIMIT,
  type IntegrationEventOpsFilter,
} from "@/server/db/integrationEventRepository";
import { syncIntegrationEvent } from "@/server/services/salesforceSync";
import { resolveSalesforceConfigFromProcessEnv } from "@/server/config/salesforceConfig";

function parseFilter(body: Record<string, unknown>): IntegrationEventOpsFilter {
  const filter: IntegrationEventOpsFilter = { status: "failed" };
  if (typeof body.eventType === "string" && body.eventType) filter.eventType = body.eventType;
  if (typeof body.clinicId === "string" && body.clinicId) filter.clinicId = body.clinicId;
  if (body.retryExhaustedOnly === true) filter.retryExhaustedOnly = true;
  if (typeof body.createdFrom === "string" && body.createdFrom) filter.createdFrom = new Date(body.createdFrom);
  if (typeof body.createdTo === "string" && body.createdTo) filter.createdTo = new Date(body.createdTo);
  return filter;
}

/**
 * ops専用: 条件を指定したfailedイベントの一括再送。
 * confirm:trueが無い呼び出しは対象件数のプレビューのみを返し、実際の更新は行わない
 * (指示書「対象件数の確認」「確認操作」を満たすための2段階方式)。
 * 1回あたりの上限はOPS_BULK_REENQUEUE_LIMIT件に固定し、無条件の全件更新は行わない。
 */
export async function POST(request: NextRequest) {
  const operator = await getCurrentOperator();
  if (!operator) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "リクエストボディがJSONとして解釈できません" }, { status: 400 });
  }
  const record = (body ?? {}) as Record<string, unknown>;
  const filter = parseFilter(record);
  const confirm = record.confirm === true;

  const matchedCount = await countIntegrationEventsForOps(filter);

  if (!confirm) {
    // プレビュー: この時点ではDBを一切変更しない。
    return NextResponse.json({
      mode: "preview",
      matchedCount,
      limit: OPS_BULK_REENQUEUE_LIMIT,
      willReenqueueCount: Math.min(matchedCount, OPS_BULK_REENQUEUE_LIMIT),
    });
  }

  if (matchedCount === 0) {
    return NextResponse.json({ mode: "executed", reenqueuedCount: 0 });
  }

  const { matchedIds, reenqueuedCount } = await reenqueueFailedIntegrationEventsBulk(filter);

  await recordAuditLog({
    operatorId: operator.id,
    action: "ops_bulk_reenqueue_integration_events",
    targetType: "IntegrationEvent",
    metadata: { filter: record, matchedCount, reenqueuedCount, targetIds: matchedIds },
  }).catch((error) => {
    console.error("[POST /api/ops/integration-events/bulk-retry] audit log recording failed:", error);
  });

  const config = resolveSalesforceConfigFromProcessEnv();
  if (config.provider === "disabled") {
    return NextResponse.json({
      mode: "executed",
      reenqueuedCount,
      salesforceDisabled: true,
      message:
        "Salesforce未接続のため、今回は送信されず「pending」として保存されました。Salesforce有効化後、定期処理で自動的に同期されます。",
    });
  }

  for (const id of matchedIds) {
    await syncIntegrationEvent(id).catch((error) => {
      console.error(`[POST /api/ops/integration-events/bulk-retry] immediate sync failed for ${id}:`, error);
    });
  }

  return NextResponse.json({ mode: "executed", reenqueuedCount, salesforceDisabled: false });
}
