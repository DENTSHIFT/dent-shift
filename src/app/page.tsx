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
      <p style={{ color: "#2563eb", fontWeight: 600, marginBottom: 8 }}>DENT SHIFT</p>
      <h1 style={{ fontSize: 28, lineHeight: 1.5 }}>
        その患者、AIは競合医院をすすめていませんか?
      </h1>
      <p style={{ color: "#555", marginTop: 16 }}>
        どこで負けているか。なぜ負けているか。次に何をすべきか。URLひとつでAIが分析。
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
      </div>
    </main>
  );
}
