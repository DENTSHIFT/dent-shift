import Link from "next/link";

export default function LandingPage() {
  return (
    <main
      style={{
        maxWidth: 640,
        margin: "0 auto",
        padding: "64px 24px",
        textAlign: "center",
      }}
    >
      {/* ロゴは正本(public/brand/logo)をそのまま使用。変形・再配色はしない
          (DESIGN_SYSTEM.md「ロゴ」節の禁止事項)。2026-09-06のユーザー指示:
          トップページの文字表示「DENT SHIFT」を正式ロゴ画像へ差し替える
          (LP全面刷新は今回のスコープ外。ロゴ置換のみの最小変更)。 */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/logo/DENT_SHIFT_horizontal_tagline_transparent.png"
        alt="DENT SHIFT 歯科集患を、AIでシフトする。"
        style={{ height: 36, marginBottom: 8 }}
      />
      {/* 2026-09-06のユーザー指示: 見出し・説明文をClaudeの推測コピーから、
          正本ドキュメント(DENT_SHIFT_CLAUDE_CODE_HANDOFF.md「1.1 プロダクト定義」
          「ブランドタグライン」/docs/PRODUCT_SPEC.md「タグライン」)に記載されている
          文言へ差し替える。新しいコピーは作成せず、正本の文言をそのまま使用する。 */}
      <h1 style={{ fontSize: 28, lineHeight: 1.5 }}>歯科集患を、AIでシフトする。</h1>
      <p style={{ color: "#555", marginTop: 16 }}>
        現状が分かる。競合との差が分かる。次に何をすればよいか分かる。予約につながったかまで分かる。
      </p>
      <div style={{ marginTop: 32 }}>
        <Link
          href="/diagnosis"
          style={{
            display: "inline-block",
            background: "#2563eb",
            color: "#fff",
            padding: "14px 32px",
            borderRadius: 999,
            textDecoration: "none",
            fontWeight: 600,
          }}
        >
          無料でAI集患診断する
        </Link>
        <p style={{ color: "#888", fontSize: 13, marginTop: 12 }}>
          営業電話なし ・ 約60秒 ・ クレジットカード不要 ・ まず結果だけ確認
        </p>
        <Link
          href="/plans"
          style={{ display: "inline-block", marginTop: 16, color: "#2563eb", fontSize: 14 }}
        >
          プランの機能を比較する
        </Link>
      </div>
    </main>
  );
}
