import Link from "next/link";
import styles from "./auth.module.css";

/**
 * 2026-09-29追加(PO指示): 存在しないURLへアクセスした際、Next.js既定の
 * 素の404ページ(ヘッダー・ナビ・戻る手段が一切無い)が表示され行き止まりに
 * なっていた問題を解消する。
 *
 * 見た目は既存の共通認証ページ(login/signup等が使う auth.module.css の
 * shell/card)をそのまま再利用し、新しいデザインは作り込まない(PO指示:
 * 「細かなUI調整をしない」)。
 *
 * 「ダッシュボードへ移動」は認証状態をここで判定せず、既存の/dashboard自体の
 * 保護ロジック(requireContact、未ログイン時は/loginへリダイレクト)に
 * そのまま委ねる。判定ロジックの重複を避けるため。
 *
 * Next.jsの規約により、この特別ファイル(not-found.tsx)がマッチした場合、
 * レスポンスは自動的にHTTP 404ステータスで返る。
 */
export default function NotFound() {
  return (
    <main className={styles.shell}>
      <div>
        <section className={styles.card}>
          <div className={styles.brand}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className={styles.logo}
              src="/brand/logo/DENT_SHIFT_horizontal_tagline_transparent.png"
              alt="DENT SHIFT 歯科集患を、AIでシフトする。"
            />
          </div>
          <h1 className={styles.title}>ページが見つかりません</h1>
          <p className={styles.description}>
            お探しのページは削除されたか、URLが変更された可能性があります。
          </p>
          <div className={styles.form}>
            <Link className={styles.primaryButton} href="/" style={{ textAlign: "center", textDecoration: "none" }}>
              トップページへ戻る
            </Link>
            <Link className={styles.secondaryButton} href="/dashboard" style={{ textAlign: "center", textDecoration: "none" }}>
              ダッシュボードへ移動
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
