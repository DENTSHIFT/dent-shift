import Link from "next/link";

const BLUE = "#2563EB";

/**
 * SP専用の画面下部sticky CTA(2026-09-25)。PC側は MarketingHeader 内の
 * sticky header CTAで常時アクセス可能なため、これは900px未満でのみ表示する。
 * 本文・フッターの固定UIと干渉しないよう高さを抑え、タップ領域は44px以上を確保する。
 */
export function MobileStickyCta({ label }: { label: string }) {
  return (
    <div className="ds-mobile-sticky-cta">
      <Link
        href="/diagnosis"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          minHeight: 48,
          boxSizing: "border-box",
          background: BLUE,
          color: "#fff",
          borderRadius: 10,
          fontSize: 14,
          fontWeight: 700,
          textDecoration: "none",
          boxShadow: "0 8px 20px rgba(37, 99, 235, 0.28)",
        }}
      >
        {label}
      </Link>
      <style>{`
        .ds-mobile-sticky-cta {
          display: block;
          position: fixed;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 30;
          box-sizing: border-box;
          width: 100%;
          padding: 10px 16px calc(10px + env(safe-area-inset-bottom));
          background: rgba(255,255,255,0.96);
          backdrop-filter: blur(6px);
          border-top: 1px solid #E5E9F0;
        }
        @media (min-width: 900px) {
          .ds-mobile-sticky-cta {
            display: none;
          }
        }
      `}</style>
    </div>
  );
}
