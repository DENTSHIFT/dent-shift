import Link from "next/link";
import { requireOperator } from "@/server/auth/requireOperator";
import { prisma } from "@/server/db/prismaClient";
import { recordAuditLog } from "@/server/db/auditLogRepository";
import { OpsLogoutButton } from "./OpsLogoutButton";
import styles from "../ops.module.css";

/**
 * 運営側ダッシュボード(最小構成)。クロステナントで医院一覧・最新契約状態を参照できる。
 * SECURITY.md「運営側はクロステナント参照が必要だが、必ず監査ログを残す専用経路を経由する」
 * に基づき、この参照自体を毎回AuditLogへ記録する。
 */
export default async function OpsDashboardPage() {
  const operator = await requireOperator();

  const clinics = await prisma.clinic.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      subscriptions: { orderBy: { createdAt: "desc" }, take: 1 },
      _count: { select: { diagnoses: true, contacts: true } },
    },
  });

  await recordAuditLog({
    operatorId: operator.id,
    action: "ops_view_clinics_list",
    targetType: "Clinic",
    metadata: { resultCount: clinics.length },
  }).catch((error) => {
    console.error("[ops/dashboard] audit log recording failed:", error);
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
            <h1 className={styles.title}>管理者用ダッシュボード</h1>
            <p className={styles.description}>医院一覧と最新の契約状態を確認できます。</p>
          </div>
          <span className={styles.countBadge}>最新{clinics.length}件を表示</span>
        </div>

        <p style={{ margin: "0 0 18px", display: "flex", gap: 16 }}>
          <Link href="/ops/invites" style={{ color: "#2563eb", fontSize: 12, fontWeight: 700, textDecoration: "none" }}>
            招待URL管理(1円モニター利用)へ →
          </Link>
          <Link href="/ops/integration-events" style={{ color: "#2563eb", fontSize: 12, fontWeight: 700, textDecoration: "none" }}>
            Salesforce連携キュー管理へ →
          </Link>
        </p>

        <section className={styles.tableCard} aria-label="医院一覧">
          <div className={styles.tableScroller}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>医院名</th>
                  <th>URL</th>
                  <th>診断回数</th>
                  <th>会員数</th>
                  <th>契約状態</th>
                  <th>登録日</th>
                </tr>
              </thead>
              <tbody>
                {clinics.map((clinic) => (
                  <tr key={clinic.id}>
                    <td className={styles.clinicName}>{clinic.name}</td>
                    <td className={styles.clinicUrl} title={clinic.url}>{clinic.url}</td>
                    <td className={styles.numeric}>{clinic._count.diagnoses}</td>
                    <td className={styles.numeric}>{clinic._count.contacts}</td>
                    <td><span className={styles.status}>{clinic.subscriptions[0]?.status ?? "未契約"}</span></td>
                    <td className={`${styles.numeric} ${styles.clinicUrl}`}>
                      {clinic.createdAt.toISOString().slice(0, 10)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
