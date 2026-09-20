import Link from "next/link";
import { SupportPhoneFooter } from "@/components/SupportPhoneFooter";

export default function LandingPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        boxSizing: "border-box",
        display: "grid",
        placeItems: "center",
        padding: "32px 20px",
        background: "#F5F7FA",
        textAlign: "center",
      }}
    >
      <section
        style={{
          width: "min(100%, 680px)",
          boxSizing: "border-box",
          padding: "52px 44px",
          border: "1px solid #E5E9F0",
          borderRadius: 20,
          background: "#fff",
          boxShadow: "0 14px 38px rgba(15,27,45,0.08)",
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
        style={{ width: 210, height: "auto", marginBottom: 18 }}
      />
      {/* 2026-09-06のユーザー指示: 見出し・説明文をClaudeの推測コピーから、
          正本ドキュメント(DENT_SHIFT_CLAUDE_CODE_HANDOFF.md「1.1 プロダクト定義」
          「ブランドタグライン」/docs/PRODUCT_SPEC.md「タグライン」)に記載されている
          文言へ差し替える。新しいコピーは作成せず、正本の文言をそのまま使用する。 */}
      <h1 style={{ margin: 0, color: "#0F1B2D", fontSize: 32, lineHeight: 1.45, letterSpacing: "-0.02em" }}>
        歯科集患を、AIでシフトする。
      </h1>
      <p style={{ maxWidth: 540, margin: "18px auto 0", color: "#6B7280", fontSize: 15, lineHeight: 1.9 }}>
        現状が分かる。競合との差が分かる。次に何をすればよいか分かる。予約につながったかまで分かる。
      </p>
      <div style={{ marginTop: 34 }}>
        <Link
          href="/diagnosis"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: 48,
            boxSizing: "border-box",
            background: "#2563eb",
            color: "#fff",
            padding: "12px 28px",
            borderRadius: 12,
            textDecoration: "none",
            fontSize: 15,
            fontWeight: 700,
            boxShadow: "0 8px 18px rgba(37,99,235,0.2)",
          }}
        >
          無料でAI集患診断する
        </Link>
        <p style={{ color: "#6B7280", fontSize: 12, margin: "14px 0 0", lineHeight: 1.6 }}>
          営業電話なし ・ 約60秒 ・ クレジットカード不要 ・ まず結果だけ確認
        </p>
        <Link
          href="/plans"
          style={{ display: "inline-block", marginTop: 18, color: "#2563EB", fontSize: 13, fontWeight: 700, textUnderlineOffset: 3 }}
        >
          プランの機能を比較する
        </Link>
      </div>
      <SupportPhoneFooter />
      </section>
    </main>
  );
}
