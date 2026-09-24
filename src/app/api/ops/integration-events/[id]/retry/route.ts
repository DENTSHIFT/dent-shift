import { NextRequest, NextResponse } from "next/server";
import { getCurrentOperator } from "@/server/auth/operatorSession";
import { recordAuditLog } from "@/server/db/auditLogRepository";
import {
  getIntegrationEventByIdForOps,
  reenqueueFailedIntegrationEvent,
} from "@/server/db/integrationEventRepository";
import { syncIntegrationEvent } from "@/server/services/salesforceSync";
import { resolveSalesforceConfigFromProcessEnv } from "@/server/config/salesforceConfig";

/**
 * ops専用: retryCount上限到達を含む、failed状態の1件を手動でpendingへ戻し、
 * 即時に同期を1回試行する。既存の/api/ops配下と同じOperatorセッション認証のみを使う
 * (2026-09-24、独自の認証・CSRF方式は追加しない)。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const operator = await getCurrentOperator();
  if (!operator) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }

  const { id } = await params;
  const event = await getIntegrationEventByIdForOps(id);
  if (!event) {
    return NextResponse.json({ error: "対象のイベントが見つかりません" }, { status: 404 });
  }
  if (event.status !== "failed") {
    // synced/pendingへの誤操作や、多重クリックによる二重実行を防ぐ
    // (すでに再送済み・処理待ちの可能性があるため、明示的に案内する)。
    return NextResponse.json(
      { error: `このイベントは現在「${event.status}」状態のため再送できません(failed状態のみ再送可能です)` },
      { status: 409 }
    );
  }

  const result = await reenqueueFailedIntegrationEvent(id);
  if (result !== "reenqueued") {
    // where句のstatus:"failed"ガードにより、上の確認後に他の操作で状態が変わった場合も
    // ここで安全に弾かれる(二重実行防止)。
    return NextResponse.json(
      { error: "再送対象ではなくなっています(既に他の操作で処理された可能性があります)" },
      { status: 409 }
    );
  }

  await recordAuditLog({
    operatorId: operator.id,
    action: "ops_reenqueue_integration_event",
    targetType: "IntegrationEvent",
    targetId: id,
    metadata: { eventType: event.eventType, previousRetryCount: event.retryCount },
  }).catch((error) => {
    console.error("[POST /api/ops/integration-events/[id]/retry] audit log recording failed:", error);
  });

  const config = resolveSalesforceConfigFromProcessEnv();
  if (config.provider === "disabled") {
    return NextResponse.json({
      status: "reenqueued",
      salesforceDisabled: true,
      message:
        "Salesforce未接続のため、今回は送信されず「pending」として保存されました。Salesforce有効化後、定期処理で自動的に同期されます。",
    });
  }

  await syncIntegrationEvent(id).catch((error) => {
    console.error(`[POST /api/ops/integration-events/[id]/retry] immediate sync failed for ${id}:`, error);
  });

  return NextResponse.json({ status: "reenqueued", salesforceDisabled: false });
}
