import Link from "next/link";
import { requireOperator } from "@/server/auth/requireOperator";
import { recordAuditLog } from "@/server/db/auditLogRepository";
import { listFailedResultEmailDiagnosesForOps } from "@/server/db/diagnosisRepository";
import { OpsLogoutButton } from "../dashboard/OpsLogoutButton";
import { ResendResultEmailButton } from "./ResendResultEmailButton";
import styles from "../ops.module.css";

function formatDateTime(value: Date | null | undefined) {
  if (!value) return "—";
  return value.toISOString().slice(0, 16).replace("T", " ");
}

/**
 * ops専用(2026-09-24): 診断結果メールの送信に失敗した診断を一覧・手動再送する。
 * Resend送信失敗は/api/diagnosisでは診断自体を失敗にしない設計(意図的なベスト
 * エフォート)のため、この画面が無いと失敗を運営側が把握・回復する手段がなかった。
 */
export default async function OpsDiagnosisResultEmailsPage() {
  const operator = await requireOperator();
  const diagnoses = await listFailedResultEmailDiagnosesForOps();

  await recordAuditLog({
    operatorId: operator.id,
    action: "ops_view_failed_result_emails",
    targetType: "Diagnosis",
    metadata: { resultCount: diagnoses.length },
  }).catch((error) => {
    console.error("[ops/diagnosis-result-emails] audit log recording failed:", error);
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
          <OpsLogoutButton />
        </div>
      </header>

      <main className={styles.content}>
        <div className={styles.pageHeader}>
          <div>
            <p className={styles.eyebrow}>社内オペレーター専用</p>
            <h1 className={styles.title}>診断結果メール送信失敗一覧</h1>
            <p className={styles.description}>
              診断結果メールの送信に失敗した診断です。診断結果自体は保存済みのため、ここから安全に再送できます。
            </p>
          </div>
          <span className={styles.countBadge}>{diagnoses.length}件</span>
        </div>

        <section className={styles.tableCard} aria-label="送信失敗一覧">
          <div className={styles.tableScroller}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>診断ID</th>
                  <th>医院名</th>
                  <th>送信先メール</th>
                  <th>診断日時</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {diagnoses.map((diagnosis) => (
                  <tr key={diagnosis.id}>
                    <td style={{ fontFamily: "monospace", fontSize: 11 }}>
                      <Link href={`/diagnosis/result/${diagnosis.id}`} style={{ color: "#2563eb" }}>
                        {diagnosis.id.slice(0, 10)}…
                      </Link>
                    </td>
                    <td className={styles.clinicName}>{diagnosis.clinic.name}</td>
                    <td className={styles.clinicUrl} title={diagnosis.clinic.contactEmail ?? undefined}>
                      {diagnosis.clinic.contactEmail ?? "未登録"}
                    </td>
                    <td className={`${styles.numeric} ${styles.clinicUrl}`}>
                      {formatDateTime(diagnosis.measuredAt)}
                    </td>
                    <td>
                      {diagnosis.clinic.contactEmail ? (
                        <ResendResultEmailButton diagnosisId={diagnosis.id} />
                      ) : (
                        <span style={{ fontSize: 11, color: "#9ca3af" }}>送信先未登録</span>
                      )}
                    </td>
                  </tr>
                ))}
                {diagnoses.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ textAlign: "center", color: "#6b7280", padding: 24 }}>
                      送信失敗中の診断結果メールはありません。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
