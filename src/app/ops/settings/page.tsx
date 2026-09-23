import { requireOperator } from "@/server/auth/requireOperator";
import { OpsLogoutButton } from "../dashboard/OpsLogoutButton";
import { ChangePasswordForm } from "./ChangePasswordForm";
import styles from "../ops.module.css";

/**
 * 運営側アカウント設定(2026-09-23追加)。現時点ではパスワード変更のみ。
 * 現在のパスワードでの再確認を必須にし、新しいパスワードはサーバーに一度も
 * 平文でログ出力しない(auth/change-password/route.ts参照)。
 */
export default async function OpsSettingsPage() {
  const operator = await requireOperator();

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
            <h1 className={styles.title}>アカウント設定</h1>
            <p className={styles.description}>パスワードの変更ができます。</p>
          </div>
        </div>

        <section
          style={{
            border: "1px solid #E5E9F0",
            borderRadius: 16,
            background: "#fff",
            padding: 20,
            boxShadow: "0 3px 12px rgba(15,27,45,.055)",
            maxWidth: 480,
          }}
        >
          <h2 style={{ margin: "0 0 16px", fontSize: 15, color: "#0F1B2D" }}>パスワード変更</h2>
          <ChangePasswordForm />
        </section>
      </main>
    </div>
  );
}
