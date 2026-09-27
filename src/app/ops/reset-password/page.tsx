import { ResetPasswordForm } from "./ResetPasswordForm";
import styles from "../ops.module.css";

/**
 * 運営側パスワード再設定の実行画面(2026-09-23追加)。トークンの検証自体は
 * 送信時にAPIルート(reset-password/route.ts)側で行う(このページはUIのみ)。
 */
export default async function OpsResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

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
        <h1 className={styles.loginTitle}>新しいパスワードの設定</h1>
        <ResetPasswordForm token={token ?? null} />
      </section>
    </main>
  );
}
