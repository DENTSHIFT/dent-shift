import { ForgotPasswordForm } from "./ForgotPasswordForm";
import styles from "../ops.module.css";

/**
 * 運営側パスワード再設定リクエスト(2026-09-23追加)。メールアドレスの存在有無を
 * 画面上で判別できないよう、常に同一メッセージを返す(ForgotPasswordForm/APIルート参照)。
 */
export default function OpsForgotPasswordPage() {
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
        <h1 className={styles.loginTitle}>パスワード再設定</h1>
        <p className={styles.loginDescription}>
          登録済みの管理者メールアドレスを入力してください。該当するアカウントが存在する場合のみ、再設定用のご案内をお送りします。
        </p>
        <ForgotPasswordForm />
      </section>
    </main>
  );
}
