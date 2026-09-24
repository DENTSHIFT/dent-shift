import Link from "next/link";
import { requireOperator } from "@/server/auth/requireOperator";
import { recordAuditLog } from "@/server/db/auditLogRepository";
import { getDiagnosisFunnelMetrics } from "@/server/db/integrationEventMetrics";
import { OpsLogoutButton } from "../dashboard/OpsLogoutButton";
import styles from "../ops.module.css";

interface SearchParams {
  from?: string;
  to?: string;
}

const DEFAULT_RANGE_DAYS = 30;

function resolveRange(sp: SearchParams): { from: Date; to: Date } {
  const to = sp.to ? new Date(`${sp.to}T23:59:59`) : new Date();
  const from = sp.from
    ? new Date(`${sp.from}T00:00:00`)
    : new Date(to.getTime() - DEFAULT_RANGE_DAYS * 24 * 60 * 60 * 1000);
  return { from, to };
}

function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function conversionRate(numerator: number, denominator: number): string {
  if (denominator === 0) return "—";
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

/**
 * 運営者が診断「開始→完了→相談CTAクリック」の件数をUTM流入元別に確認できる画面
 * (2026-09-24)。IntegrationEventはSalesforce同期状態と無関係にイベント発生を記録して
 * いるため、Salesforce未接続の間もこの画面の件数は正しく機能する。
 */
export default async function OpsMetricsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const operator = await requireOperator();
  const sp = await searchParams;
  const range = resolveRange(sp);

  const metrics = await getDiagnosisFunnelMetrics(range);

  await recordAuditLog({
    operatorId: operator.id,
    action: "ops_view_diagnosis_funnel_metrics",
    targetType: "IntegrationEvent",
    metadata: { from: range.from.toISOString(), to: range.to.toISOString() },
  }).catch((error) => {
    console.error("[ops/metrics] audit log recording failed:", error);
  });

  const utmRows = Object.entries(metrics.byUtmSource).sort(
    (a, b) => b[1].started + b[1].completed - (a[1].started + a[1].completed)
  );

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

      <main className={styles.content}>
        <div className={styles.pageHeader}>
          <div>
            <p className={styles.eyebrow}>社内オペレーター専用</p>
            <h1 className={styles.title}>診断ファネル計測（開始・完了・相談CTA）</h1>
            <p className={styles.description}>
              Salesforce連携の有無に関わらず、DENT SHIFT側のIntegrationEventログから件数を集計します。
              現時点の記録先はSalesforceではなく既存のIntegrationEventです。
            </p>
          </div>
        </div>

        <form method="GET" style={{ display: "flex", gap: 10, alignItems: "flex-end", marginBottom: 20 }}>
          <label style={{ fontSize: 12, fontWeight: 650, color: "#40506a" }}>
            開始日
            <input
              type="date"
              name="from"
              defaultValue={toDateInputValue(range.from)}
              className={styles.input}
              style={{ minHeight: 36, marginTop: 4 }}
            />
          </label>
          <label style={{ fontSize: 12, fontWeight: 650, color: "#40506a" }}>
            終了日
            <input
              type="date"
              name="to"
              defaultValue={toDateInputValue(range.to)}
              className={styles.input}
              style={{ minHeight: 36, marginTop: 4 }}
            />
          </label>
          <button type="submit" className={styles.loginButton} style={{ minHeight: 36, padding: "8px 16px" }}>
            期間で絞り込む
          </button>
          <Link
            href="/ops/metrics"
            style={{ fontSize: 12, color: "#2563EB", marginLeft: 8 }}
          >
            直近{DEFAULT_RANGE_DAYS}日にリセット
          </Link>
        </form>

        <div className={`${styles.tableCard}`} style={{ padding: 20, marginBottom: 20 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 16 }}>
            <div>
              <p style={{ margin: 0, fontSize: 11, color: "#6b7280" }}>診断開始</p>
              <p style={{ margin: "4px 0 0", fontSize: 28, fontWeight: 800, color: "#0f1b2d" }}>{metrics.started}</p>
            </div>
            <div>
              <p style={{ margin: 0, fontSize: 11, color: "#6b7280" }}>診断完了</p>
              <p style={{ margin: "4px 0 0", fontSize: 28, fontWeight: 800, color: "#0f1b2d" }}>{metrics.completed}</p>
              <p style={{ margin: "2px 0 0", fontSize: 11, color: "#9ca3af" }}>
                開始→完了 {conversionRate(metrics.completed, metrics.started)}
              </p>
            </div>
            <div>
              <p style={{ margin: 0, fontSize: 11, color: "#6b7280" }}>相談CTAクリック</p>
              <p style={{ margin: "4px 0 0", fontSize: 28, fontWeight: 800, color: "#0f1b2d" }}>
                {metrics.consultationClicked}
              </p>
              <p style={{ margin: "2px 0 0", fontSize: 11, color: "#9ca3af" }}>
                完了→相談 {conversionRate(metrics.consultationClicked, metrics.completed)}
              </p>
            </div>
            <div>
              <p style={{ margin: 0, fontSize: 11, color: "#6b7280" }}>UTM未付与（直接流入等）</p>
              <p style={{ margin: "4px 0 0", fontSize: 28, fontWeight: 800, color: "#0f1b2d" }}>
                {metrics.unattributedCount}
              </p>
            </div>
          </div>
        </div>

        <section className={styles.tableCard} aria-label="UTM流入元別の内訳">
          <div className={styles.tableScroller}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>utm_source</th>
                  <th>開始</th>
                  <th>完了</th>
                  <th>相談CTA</th>
                  <th>開始→完了</th>
                </tr>
              </thead>
              <tbody>
                {utmRows.map(([source, counts]) => (
                  <tr key={source}>
                    <td className={styles.clinicName}>{source}</td>
                    <td className={styles.numeric}>{counts.started}</td>
                    <td className={styles.numeric}>{counts.completed}</td>
                    <td className={styles.numeric}>{counts.consultationClicked}</td>
                    <td className={styles.numeric}>{conversionRate(counts.completed, counts.started)}</td>
                  </tr>
                ))}
                {utmRows.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ textAlign: "center", color: "#6b7280", padding: 24 }}>
                      この期間にUTM付きのイベントはありません。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <p style={{ marginTop: 16, fontSize: 11, color: "#9ca3af" }}>
          対象期間内にスキャンしたイベント件数: {metrics.totalEventsScanned}件
        </p>
      </main>
    </div>
  );
}
