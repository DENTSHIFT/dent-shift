import Link from "next/link";

const NAVY = "#0F1B2D";

/**
 * 広告LP専用ヘッダー(2026-09-22最終修正)。モバイルでCTAが画面外に切れる問題を解消:
 * 左ロゴは上限120px、右CTAはflex-shrink:0で必ず全体表示、「料金」リンクは
 * モバイルで非表示にする(ハンバーガーメニューは今回のスコープでは設けず、
 * フッターのSERVICE列に料金リンクがあるため導線は維持される)。
 */
export function MarketingHeader() {
  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 20,
        width: "100%",
        background: "rgba(255,255,255,0.94)",
        backdropFilter: "blur(6px)",
        borderBottom: "1px solid #E5E9F0",
      }}
    >
      <div
        style={{
          maxWidth: 1080,
          margin: "0 auto",
          padding: "10px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          minWidth: 0,
        }}
      >
        <Link href="/" style={{ display: "inline-flex", minWidth: 0, flexShrink: 1 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/logo/DENT_SHIFT_official_2026-09-24.png"
            alt="DENT SHIFT 歯科集患を、AIでシフトする。"
            width={1254}
            height={1254}
            // 2026-09-27: ロゴが横型(1844x572)から正方形(1254x1254)の正式版へ変更。
            // ロゴ自体の比率・配置は変更せず、スティッキーヘッダーの高さに収まるよう
            // 表示枠(高さ基準)だけ調整する(旧: 幅120px基準で実効高さ約37px相当)。
            style={{ height: 40, width: "auto", display: "block" }}
          />
        </Link>
        <nav style={{ display: "flex", alignItems: "center", gap: 16, flexShrink: 0 }}>
          <Link
            href="/plans"
            className="ds-marketing-nav-link"
            style={{
              color: NAVY,
              fontSize: 13,
              fontWeight: 600,
              textDecoration: "none",
              whiteSpace: "nowrap",
            }}
          >
            料金
          </Link>
          <Link
            href="/diagnosis"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: 44,
              padding: "0 14px",
              background: "#2563EB",
              color: "#fff",
              borderRadius: 8,
              fontSize: 12.5,
              fontWeight: 700,
              textDecoration: "none",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            無料診断
          </Link>
        </nav>
      </div>
      <style>{`
        .ds-marketing-nav-link { display: none; }
        @media (min-width: 640px) {
          .ds-marketing-nav-link { display: inline-flex !important; }
        }
      `}</style>
    </header>
  );
}
