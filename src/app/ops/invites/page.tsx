import { requireOperator } from "@/server/auth/requireOperator";
import { listInvites } from "@/server/db/inviteRepository";
import { recordAuditLog } from "@/server/db/auditLogRepository";
import { OpsLogoutButton } from "../dashboard/OpsLogoutButton";
import { CreateInviteForm } from "./CreateInviteForm";
import styles from "../ops.module.css";

const STATUS_LABELS: Record<string, string> = {
  active: "未使用",
  used: "使用済み",
  expired: "期限切れ",
  revoked: "無効化",
};

function formatDate(value: Date | null) {
  if (!value) return "—";
  return value.toISOString().slice(0, 10);
}

/**
 * 知人院長向け「1円モニター利用」招待の発行・一覧管理(2026-09-22確定)。
 * 通常のOperatorセッションを要求し、通常ユーザーは絶対に到達できない経路にする。
 */
export default async function OpsInvitesPage() {
  const operator = await requireOperator();
  const invites = await listInvites();

  await recordAuditLog({
    operatorId: operator.id,
    action: "ops_view_invites_list",
    targetType: "Invite",
    metadata: { resultCount: invites.length },
  }).catch((error) => {
    console.error("[ops/invites] audit log recording failed:", error);
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
            <h1 className={styles.title}>招待URL管理(1円モニター利用)</h1>
            <p className={styles.description}>
              通常LP・料金表には表示されない、招待専用URLの発行・利用状況を管理します。
            </p>
          </div>
          <span className={styles.countBadge}>{invites.length}件</span>
        </div>

        <CreateInviteForm />

        <section className={styles.tableCard} aria-label="招待一覧" style={{ marginTop: 20 }}>
          <div className={styles.tableScroller}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>招待コード</th>
                  <th>対象医院名</th>
                  <th>メールアドレス</th>
                  <th>有効期限</th>
                  <th>使用回数</th>
                  <th>ステータス</th>
                  <th>利用開始日</th>
                  <th>利用終了予定日</th>
                </tr>
              </thead>
              <tbody>
                {invites.map((invite) => {
                  const usageEndsAt = invite.usedAt
                    ? new Date(invite.usedAt)
                    : null;
                  if (usageEndsAt) usageEndsAt.setUTCMonth(usageEndsAt.getUTCMonth() + invite.durationMonths);
                  return (
                    <tr key={invite.id}>
                      <td className={styles.clinicName} style={{ fontFamily: "monospace", fontSize: 11 }}>
                        {invite.inviteCode}
                      </td>
                      <td className={styles.clinicName}>{invite.clinicName}</td>
                      <td className={styles.clinicUrl} title={invite.email}>
                        {invite.email}
                      </td>
                      <td className={`${styles.numeric} ${styles.clinicUrl}`}>
                        {formatDate(invite.expiresAt)}
                      </td>
                      <td className={styles.numeric}>
                        {invite.usedCount} / {invite.maxUses}
                      </td>
                      <td>
                        <span className={styles.status}>
                          {STATUS_LABELS[invite.status] ?? invite.status}
                        </span>
                      </td>
                      <td className={`${styles.numeric} ${styles.clinicUrl}`}>
                        {formatDate(invite.usedAt)}
                      </td>
                      <td className={`${styles.numeric} ${styles.clinicUrl}`}>
                        {formatDate(usageEndsAt)}
                      </td>
                    </tr>
                  );
                })}
                {invites.length === 0 && (
                  <tr>
                    <td colSpan={8} style={{ textAlign: "center", color: "#6b7280", padding: 24 }}>
                      発行済みの招待はありません。
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
