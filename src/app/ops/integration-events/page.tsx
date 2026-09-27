import Link from "next/link";
import { requireOperator } from "@/server/auth/requireOperator";
import { recordAuditLog } from "@/server/db/auditLogRepository";
import {
  listIntegrationEventsForOps,
  OPS_BULK_REENQUEUE_LIMIT,
  type IntegrationEventOpsFilter,
} from "@/server/db/integrationEventRepository";
import { MAX_RETRY_COUNT } from "@/server/services/salesforceSync";
import { INTEGRATION_EVENT_TYPES } from "@/domain/integration/events";
import { OpsLogoutButton } from "../dashboard/OpsLogoutButton";
import { IntegrationEventRetryButton } from "./IntegrationEventRetryButton";
import { IntegrationEventBulkRetryPanel } from "./IntegrationEventBulkRetryPanel";
import styles from "../ops.module.css";

const STATUS_LABELS: Record<string, string> = {
  pending: "保留中",
  processing: "処理中",
  synced: "同期済み",
  failed: "失敗",
};

function formatDateTime(value: Date | null | undefined) {
  if (!value) return "—";
  return value.toISOString().slice(0, 16).replace("T", " ");
}

interface SearchParams {
  status?: string;
  eventType?: string;
  clinicId?: string;
  retryExhausted?: string;
  createdFrom?: string;
  createdTo?: string;
  page?: string;
}

function buildFilterFromSearchParams(sp: SearchParams): IntegrationEventOpsFilter {
  const filter: IntegrationEventOpsFilter = {};
  if (sp.status) filter.status = sp.status;
  if (sp.eventType) filter.eventType = sp.eventType;
  if (sp.clinicId) filter.clinicId = sp.clinicId;
  if (sp.retryExhausted === "1") filter.retryExhaustedOnly = true;
  if (sp.createdFrom) filter.createdFrom = new Date(sp.createdFrom);
  if (sp.createdTo) filter.createdTo = new Date(`${sp.createdTo}T23:59:59`);
  return filter;
}

function buildPageHref(sp: SearchParams, page: number): string {
  const params = new URLSearchParams();
  if (sp.status) params.set("status", sp.status);
  if (sp.eventType) params.set("eventType", sp.eventType);
  if (sp.clinicId) params.set("clinicId", sp.clinicId);
  if (sp.retryExhausted === "1") params.set("retryExhausted", "1");
  if (sp.createdFrom) params.set("createdFrom", sp.createdFrom);
  if (sp.createdTo) params.set("createdTo", sp.createdTo);
  params.set("page", String(page));
  return `/ops/integration-events?${params.toString()}`;
}

/**
 * ops専用: Salesforce連携キュー(IntegrationEvent)の確認・安全な再送(2026-09-24)。
 * Salesforceのオブジェクト構成・項目マッピング・immedio連携には踏み込まず、
 * 既存キューの可視化と、failed状態イベントの手動再投入のみを扱う。
 * 通常のOperatorセッションを要求し、通常ユーザーは絶対に到達できない経路にする。
 */
export default async function OpsIntegrationEventsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const operator = await requireOperator();
  const sp = await searchParams;
  const filter = buildFilterFromSearchParams(sp);
  const page = sp.page ? Math.max(1, parseInt(sp.page, 10) || 1) : 1;

  const { items, total, pageSize } = await listIntegrationEventsForOps(filter, page);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  await recordAuditLog({
    operatorId: operator.id,
    action: "ops_view_integration_events_list",
    targetType: "IntegrationEvent",
    metadata: { filter: sp, resultCount: items.length, total },
  }).catch((error) => {
    console.error("[ops/integration-events] audit log recording failed:", error);
  });

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
          <Link
            href="/ops/settings"
            style={{ fontSize: 12, fontWeight: 700, color: "#2563EB", textDecoration: "none" }}
          >
            設定
          </Link>
          <OpsLogoutButton />
        </div>
      </header>

      <main className={styles.content}>
        <div className={styles.pageHeader}>
          <div>
            <p className={styles.eyebrow}>社内オペレーター専用</p>
            <h1 className={styles.title}>Salesforce連携キュー(IntegrationEvent)</h1>
            <p className={styles.description}>
              Salesforce同期の保留・失敗イベントを確認し、原因解消後に安全に再送できます。
              retryCount={MAX_RETRY_COUNT}に到達したイベントは自動再送の対象外のため、ここから手動で再投入してください。
            </p>
          </div>
          <span className={styles.countBadge}>{total}件</span>
        </div>

        <form method="GET" style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 18, alignItems: "flex-end" }}>
          <label style={{ fontSize: 12, fontWeight: 650, color: "#40506a" }}>
            ステータス
            <select name="status" defaultValue={sp.status ?? ""} className={styles.input} style={{ minHeight: 36, marginTop: 4 }}>
              <option value="">すべて</option>
              <option value="pending">保留中</option>
              <option value="failed">失敗</option>
              <option value="synced">同期済み</option>
            </select>
          </label>
          <label style={{ fontSize: 12, fontWeight: 650, color: "#40506a" }}>
            イベント種別
            <select name="eventType" defaultValue={sp.eventType ?? ""} className={styles.input} style={{ minHeight: 36, marginTop: 4 }}>
              <option value="">すべて</option>
              {INTEGRATION_EVENT_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: 12, fontWeight: 650, color: "#40506a" }}>
            医院ID
            <input type="text" name="clinicId" defaultValue={sp.clinicId ?? ""} className={styles.input} style={{ minHeight: 36, marginTop: 4, width: 160 }} />
          </label>
          <label style={{ fontSize: 12, fontWeight: 650, color: "#40506a" }}>
            発生日(開始)
            <input type="date" name="createdFrom" defaultValue={sp.createdFrom ?? ""} className={styles.input} style={{ minHeight: 36, marginTop: 4 }} />
          </label>
          <label style={{ fontSize: 12, fontWeight: 650, color: "#40506a" }}>
            発生日(終了)
            <input type="date" name="createdTo" defaultValue={sp.createdTo ?? ""} className={styles.input} style={{ minHeight: 36, marginTop: 4 }} />
          </label>
          <label style={{ fontSize: 12, fontWeight: 650, color: "#40506a", display: "flex", alignItems: "center", gap: 6, minHeight: 36 }}>
            <input type="checkbox" name="retryExhausted" value="1" defaultChecked={sp.retryExhausted === "1"} />
            上限到達(retryCount≧{MAX_RETRY_COUNT})のみ
          </label>
          <button type="submit" className={styles.loginButton} style={{ minHeight: 36, padding: "8px 16px" }}>
            絞り込み
          </button>
        </form>

        {filter.status === "failed" || sp.retryExhausted === "1" ? (
          <IntegrationEventBulkRetryPanel filter={filter} matchedCount={total} limit={OPS_BULK_REENQUEUE_LIMIT} />
        ) : null}

        <section className={styles.tableCard} aria-label="IntegrationEvent一覧" style={{ marginTop: 20 }}>
          <div className={styles.tableScroller}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>イベントID</th>
                  <th>種別</th>
                  <th>医院ID</th>
                  <th>担当者ID</th>
                  <th>発生日時</th>
                  <th>ステータス</th>
                  <th>再試行回数</th>
                  <th>最終エラー</th>
                  <th>最終試行日時</th>
                  <th>同期日時</th>
                  <th>上限到達</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((event) => {
                  const exhausted = event.retryCount >= MAX_RETRY_COUNT;
                  return (
                    <tr key={event.id}>
                      <td style={{ fontFamily: "monospace", fontSize: 11 }}>
                        <Link href={`/ops/integration-events/${event.id}`} style={{ color: "#2563eb" }}>
                          {event.id.slice(0, 10)}…
                        </Link>
                      </td>
                      <td style={{ fontFamily: "monospace", fontSize: 11 }}>{event.eventType}</td>
                      <td className={styles.clinicUrl} title={event.clinicId ?? undefined}>{event.clinicId ?? "—"}</td>
                      <td className={styles.clinicUrl} title={event.contactId ?? undefined}>{event.contactId ?? "—"}</td>
                      <td className={`${styles.numeric} ${styles.clinicUrl}`}>{formatDateTime(event.createdAt)}</td>
                      <td>
                        <span className={styles.status}>{STATUS_LABELS[event.status] ?? event.status}</span>
                      </td>
                      <td className={styles.numeric}>{event.retryCount} / {MAX_RETRY_COUNT}</td>
                      <td className={styles.clinicUrl} title={event.lastError ?? undefined}>{event.lastError ?? "—"}</td>
                      <td className={`${styles.numeric} ${styles.clinicUrl}`}>{formatDateTime(event.lastAttemptedAt)}</td>
                      <td className={`${styles.numeric} ${styles.clinicUrl}`}>{formatDateTime(event.processedAt)}</td>
                      <td>{exhausted ? "到達" : "—"}</td>
                      <td>
                        {event.status === "failed" ? (
                          <IntegrationEventRetryButton eventId={event.id} />
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })}
                {items.length === 0 && (
                  <tr>
                    <td colSpan={12} style={{ textAlign: "center", color: "#6b7280", padding: 24 }}>
                      該当するイベントはありません。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {totalPages > 1 && (
          <nav style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 16, fontSize: 12 }}>
            {page > 1 && (
              <Link href={buildPageHref(sp, page - 1)} style={{ color: "#2563eb" }}>← 前へ</Link>
            )}
            <span style={{ color: "#6b7280" }}>{page} / {totalPages}ページ</span>
            {page < totalPages && (
              <Link href={buildPageHref(sp, page + 1)} style={{ color: "#2563eb" }}>次へ →</Link>
            )}
          </nav>
        )}
      </main>
    </div>
  );
}
