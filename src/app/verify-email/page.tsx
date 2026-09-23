import Link from "next/link";
import { verifyEmailToken } from "@/server/services/verifyEmailToken";
import { findActiveUnusedPilotInviteByEmail } from "@/server/db/inviteRepository";
import styles from "../auth.module.css";

/**
 * メール確認リンクの着地画面(2026-09-24追加)。従来は/api/auth/verify-emailの
 * 生JSONがそのまま表示されていたため、一般ユーザー向けの完了画面に置き換えた。
 * 検証処理本体はverifyEmailToken()(API層と共通)を直接呼ぶ。
 * Pilot招待経由の会員登録の場合は、未使用の招待が残っていれば招待ページへ戻れる
 * 導線を出す(招待コードそのものはURLに含めない。emailの一致だけで検索する)。
 */
export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token) {
    return (
      <Shell>
        <h1 className={styles.title}>確認リンクが正しくありません</h1>
        <p className={styles.description}>
          URLに確認トークンが含まれていません。メール内のリンクをもう一度お確かめください。
        </p>
        <BackToDashboardLink />
      </Shell>
    );
  }

  const result = await verifyEmailToken(token);

  if (result.status === "error") {
    return (
      <Shell>
        <h1 className={styles.title}>確認できませんでした</h1>
        <p className={styles.description}>
          {result.code === "expired"
            ? "確認リンクの有効期限が切れています。ダッシュボードから再送してください。"
            : "この確認リンクは無効です。リンクの有効期限切れ、または既に使用済みの可能性があります。"}
        </p>
        <BackToDashboardLink />
      </Shell>
    );
  }

  const invite = await findActiveUnusedPilotInviteByEmail(result.email).catch(() => null);

  return (
    <Shell>
      <h1 className={styles.title}>メールアドレスの確認が完了しました</h1>
      <p className={styles.description}>
        {result.status === "already_verified"
          ? "このメールアドレスは既に確認済みです。"
          : "ご登録のメールアドレスが確認できました。"}
      </p>
      <div style={{ marginTop: 20, display: "grid", gap: 10 }}>
        {invite && (
          <Link className={styles.primaryButton} style={{ textAlign: "center", textDecoration: "none" }} href={`/invite/${invite.inviteCode}`}>
            招待ページに戻る
          </Link>
        )}
        <Link
          className={invite ? styles.secondaryButton : styles.primaryButton}
          style={{ textAlign: "center", textDecoration: "none" }}
          href="/dashboard"
        >
          DENT SHIFTへ戻る
        </Link>
      </div>
    </Shell>
  );
}

function BackToDashboardLink() {
  return (
    <div style={{ marginTop: 20 }}>
      <Link className={styles.primaryButton} style={{ textAlign: "center", textDecoration: "none" }} href="/dashboard">
        DENT SHIFTへ戻る
      </Link>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className={styles.shell}>
      <div className={`${styles.card} ${styles.cardWide}`}>
        <div className={styles.brand}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className={styles.logo}
            src="/brand/logo/DENT_SHIFT_horizontal_tagline_transparent.png"
            alt="DENT SHIFT 歯科集患を、AIでシフトする。"
          />
        </div>
        {children}
      </div>
    </main>
  );
}
