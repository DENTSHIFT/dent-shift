import Link from "next/link";
import { SupportPhoneFooter } from "@/components/SupportPhoneFooter";
import { LEGAL_PAGES, isLegalPagePubliclyVisible, type LegalPageSlug } from "@/domain/legal/legalPages";

const NAVY = "#0F1B2D";
const MUTED = "#6B7280";

const SERVICE_LINKS = [
  { label: "DENT SHIFTとは", href: "/#what-you-get" },
  { label: "機能", href: "/plans" },
  { label: "料金", href: "/plans" },
  { label: "無料AI集患診断", href: "/diagnosis" },
  { label: "FAQ", href: "/#faq" },
];

const INSTAGRAM_LINKS = [
  { label: "DENT SHIFT公式Instagram", href: "https://www.instagram.com/dentshift_official/" },
  { label: "寧々ちゃんのInstagram", href: "https://www.instagram.com/dentshift_nene/" },
];

function InstagramIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
      <rect x="3" y="3" width="18" height="18" rx="5" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="12" r="4.2" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="17.2" cy="6.8" r="1.1" fill="currentColor" />
    </svg>
  );
}

const COMPANY_SLUGS: LegalPageSlug[] = ["company", "contact"];
const LEGAL_SLUGS: LegalPageSlug[] = ["terms", "privacy", "tokushoho", "cookies"];

// 2026-09-23のユーザー指示: 承認済み本文(approvedBody)があるページだけをフッターに表示する。
// noindexはアクセス制御ではないため、「公開フッターに出すかどうか」自体を
// isLegalPagePubliclyVisible(唯一の判定基準)で決める。未承認の間は該当セクションごと
// 表示しない(空のhref/"#"を残すよりも、リンク自体を出さない方を優先する)。
function buildColumns() {
  const companyLinks = COMPANY_SLUGS.map((slug) => LEGAL_PAGES[slug])
    .filter(isLegalPagePubliclyVisible)
    .map((page) => ({ label: page.navLabel, href: `/legal/${page.slug}` }));
  const legalLinks = LEGAL_SLUGS.map((slug) => LEGAL_PAGES[slug])
    .filter(isLegalPagePubliclyVisible)
    .map((page) => ({ label: page.navLabel, href: `/legal/${page.slug}` }));

  return [
    { heading: "SERVICE", links: SERVICE_LINKS },
    ...(companyLinks.length > 0 ? [{ heading: "COMPANY", links: companyLinks }] : []),
    ...(legalLinks.length > 0 ? [{ heading: "LEGAL", links: legalLinks }] : []),
  ];
}

/**
 * 広告LP専用のフッター(2026-09-22のユーザー指示: ページ種別ごとに出し分け、
 * 全ページへ強制適用しない)。運営会社セクションは大きく置かず、リンク集約のみ。
 */
export function MarketingFooter() {
  const columns = buildColumns();
  return (
    <footer style={{ background: "#F5F7FA", borderTop: "1px solid #E5E9F0", marginTop: 0 }}>
      <div
        style={{
          maxWidth: 1080,
          margin: "0 auto",
          padding: "48px 20px 28px",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 32,
        }}
      >
        {columns.map((col) => (
          <div key={col.heading}>
            <p style={{ margin: "0 0 12px", fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", color: MUTED }}>
              {col.heading}
            </p>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
              {col.links.map((link) => (
                <li key={link.label}>
                  <Link href={link.href} style={{ fontSize: 13, color: NAVY, textDecoration: "none" }}>
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "0 20px 32px" }}>
        <SupportPhoneFooter />
        <p style={{ marginTop: 20, textAlign: "center", fontSize: 11, color: MUTED }}>
          運営会社: エムコレクションジャパン合同会社
          {" ／ "}
          <a
            href="https://mcollection-japan.jp"
            target="_blank"
            rel="noreferrer"
            style={{ color: NAVY, textDecoration: "underline" }}
          >
            コーポレートサイト
          </a>
        </p>
        <p style={{ marginTop: 8, textAlign: "center", fontSize: 11, color: MUTED }}>
          © DENT SHIFT
        </p>
        <div
          style={{
            marginTop: 16,
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            gap: 16,
          }}
        >
          {INSTAGRAM_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              target="_blank"
              rel="noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: 11,
                color: MUTED,
                textDecoration: "none",
                overflowWrap: "anywhere",
              }}
            >
              <InstagramIcon />
              {link.label}
            </a>
          ))}
        </div>
      </div>
    </footer>
  );
}
