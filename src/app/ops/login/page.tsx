import { OpsLoginForm } from "./OpsLoginForm";
import styles from "../ops.module.css";

/**
 * 運営側(社内オペレーター)ログイン。医院側/login とは別ドメインの認証
 * (SECURITY.md「認証ドメインを2系統に分ける」)。Operatorアカウントは社内で個別発行する
 * ため、このページに新規登録導線は置かない。
 */
export default function OpsLoginPage() {
  return (
    <main className={styles.loginShell}>
      <section className={styles.loginCard}>
        <div className={styles.loginBrand}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className={styles.loginLogo}
            src="/brand/logo/DENT_SHIFT_horizontal_tagline_transparent.png"
            alt="DENT SHIFT 歯科集患を、AIでシフトする。"
          />
          <span className={styles.adminBadge}>管理者用</span>
        </div>
        <h1 className={styles.loginTitle}>管理者用ログイン</h1>
        <p className={styles.loginDescription}>
          社内オペレーター専用です。アカウントは個別発行されます。
        </p>
        <OpsLoginForm />
      </section>
    </main>
  );
}
