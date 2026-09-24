import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOperator } from "@/server/auth/requireOperator";
import { recordAuditLog } from "@/server/db/auditLogRepository";
import { getIntegrationEventByIdForOps } from "@/server/db/integrationEventRepository";
import { MAX_RETRY_COUNT } from "@/server/services/salesforceSync";
import { redactIntegrationEventPayloadForOps } from "@/domain/integration/events";
import { OpsLogoutButton } from "../../dashboard/OpsLogoutButton";
import { IntegrationEventRetryButton } from "../IntegrationEventRetryButton";
import styles from "../../ops.module.css";

function formatDateTime(value: Date | null | undefined) {
  if (!value) return "—";
  return value.toISOString().slice(0, 19).replace("T", " ");
}

/**
 * IntegrationEvent 1件の詳細(ops専用)。payloadは個人情報らしきキーの値を
 * マスクしたうえでのみ表示する(禁止キー・認証情報はそもそもDBへ保存されない
 * 設計だが、念のためここでも生のpayloadをそのまま出力しない)。
 */
export default async function OpsIntegrationEventDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const operator = await requireOperator();
  const { id } = await params;
  const event = await getIntegrationEventByIdForOps(id);
  if (!event) notFound();

  await recordAuditLog({
    operatorId: operator.id,
    action: "ops_view_integration_event_detail",
    targetType: "IntegrationEvent",
    targetId: id,
  }).catch((error) => {
    console.error("[ops/integration-events/[id]] audit log recording failed:", error);
  });

  let redactedPayload: Record<string, unknown> = {};
  try {
    redactedPayload = redactIntegrationEventPayloadForOps(JSON.parse(event.payloadJson));
  } catch {
    redactedPayload = { error: "payloadの解析に失敗しました" };
  }

  const exhausted = event.retryCount >= MAX_RETRY_COUNT;

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.brand}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className={styles.logo}
            src="/brand/logo/DENT_SHIFT_horizontal_tagline_transparent.png"
            alt="DENT SHIFT 歯科集患を、AIでシフトする。"
          />
          <span className={styles.adminBadge}>管理者用</span>
        </div>
        <div className={styles.operator}>
          <div className={styles.operatorMeta}>
            <p className={styles.operatorEmail}>{operator.email}</p>
            <p className={styles.operatorRole}>権限: {operator.role}</p>
          </div>
          <OpsLogoutButton />
        </div>
      </header>

      <main className={styles.content} style={{ maxWidth: 760 }}>
        <p className={styles.eyebrow}>
          <Link href="/ops/integration-events" style={{ color: "#2563eb" }}>← 一覧へ戻る</Link>
        </p>
        <h1 className={styles.title} style={{ fontSize: 20 }}>IntegrationEvent詳細</h1>

        <section className={styles.tableCard} style={{ padding: 20, marginTop: 16 }}>
          <dl style={{ display: "grid", gridTemplateColumns: "160px 1fr", rowGap: 10, columnGap: 12, fontSize: 13 }}>
            <dt style={{ color: "#6b7280" }}>イベントID</dt>
            <dd style={{ fontFamily: "monospace" }}>{event.id}</dd>

            <dt style={{ color: "#6b7280" }}>イベント種別</dt>
            <dd style={{ fontFamily: "monospace" }}>{event.eventType}</dd>

            <dt style={{ color: "#6b7280" }}>医院ID</dt>
            <dd>{event.clinicId ?? "—"}</dd>

            <dt style={{ color: "#6b7280" }}>担当者ID</dt>
            <dd>{event.contactId ?? "—"}</dd>

            <dt style={{ color: "#6b7280" }}>ステータス</dt>
            <dd><span className={styles.status}>{event.status}</span></dd>

            <dt style={{ color: "#6b7280" }}>再試行回数</dt>
            <dd>{event.retryCount} / {MAX_RETRY_COUNT} {exhausted && <b style={{ color: "#b45309" }}>(上限到達)</b>}</dd>

            <dt style={{ color: "#6b7280" }}>最終エラー</dt>
            <dd style={{ wordBreak: "break-word" }}>{event.lastError ?? "—"}</dd>

            <dt style={{ color: "#6b7280" }}>発生日時</dt>
            <dd>{formatDateTime(event.createdAt)}</dd>

            <dt style={{ color: "#6b7280" }}>最終試行日時</dt>
            <dd>{formatDateTime(event.lastAttemptedAt)}</dd>

            <dt style={{ color: "#6b7280" }}>同期完了日時</dt>
            <dd>{formatDateTime(event.processedAt)}</dd>

            <dt style={{ color: "#6b7280" }}>Salesforce側ID</dt>
            <dd>{event.externalId ?? "—"}</dd>
          </dl>

          <h2 style={{ fontSize: 13, fontWeight: 700, marginTop: 24, marginBottom: 8, color: "#40506a" }}>
            payload(個人情報らしき値はマスク済み)
          </h2>
          <pre
            style={{
              background: "#f8fafc",
              border: "1px solid #e5e9f0",
              borderRadius: 8,
              padding: 12,
              fontSize: 12,
              overflowX: "auto",
            }}
          >
            {JSON.stringify(redactedPayload, null, 2)}
          </pre>

          {event.status === "failed" && (
            <div style={{ marginTop: 20 }}>
              <IntegrationEventRetryButton eventId={event.id} />
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
