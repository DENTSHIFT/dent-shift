import Link from "next/link";
import { getCurrentContact } from "@/server/auth/session";

const NAVY = "#0F1B2D";

/**
 * 広告LP専用ヘッダー(2026-09-22最終修正)。モバイルでCTAが画面外に切れる問題を解消:
 * 左ロゴは上限120px、右CTAはflex-shrink:0で必ず全体表示、「料金」リンクは
 * モバイルで非表示にする(ハンバーガーメニューは今回のスコープでは設けず、
 * フッターのSERVICE列に料金リンクがあるため導線は維持される)。
 *
 * 2026-09-29追加(PO指示): トップページにログイン導線が無く、既存会員が
 * ダッシュボードへ迷わずたどり着けない問題を解消する。認証判定は
 * 既存のセッションCookie検証(getCurrentContact、/api/auth/me等が使うものと同一)を
 * サーバーコンポーネント内でそのまま利用し、新しい判定ロジックは追加しない。
 * 未ログイン時: 「料金｜ログイン｜無料診断」
 * ログイン済み時: 「料金｜ダッシュボード」(ログイン・無料診断は非表示)
 */
export async function MarketingHeader() {
  const contact = await getCurrentContact();
  const isAuthenticated = Boolean(contact);

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
            src="/brand/logo/DENT_SHIFT_horizontal_tagline_transparent.png"
            alt="DENT SHIFT 歯科集患を、AIでシフトする。"
            width={1844}
            height={572}
            style={{ height: "auto", maxWidth: 120, width: "100%" }}
          />
        </Link>
        <nav
          aria-label="サイトナビゲーション"
          style={{ display: "flex", alignItems: "center", gap: 16, flexShrink: 0 }}
        >
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
          {isAuthenticated ? (
            <Link
              href="/dashboard"
              className="ds-marketing-nav-link"
              style={{
                color: NAVY,
                fontSize: 13,
                fontWeight: 600,
                textDecoration: "none",
                whiteSpace: "nowrap",
              }}
            >
              ダッシュボード
            </Link>
          ) : (
            <Link
              href="/login"
              className="ds-marketing-nav-link ds-marketing-login-link"
              style={{
                color: NAVY,
                fontSize: 13,
                fontWeight: 600,
                textDecoration: "none",
                whiteSpace: "nowrap",
                border: `1px solid ${NAVY}`,
                borderRadius: 8,
                padding: "8px 14px",
                background: "#fff",
              }}
            >
              ログイン
            </Link>
          )}
          {isAuthenticated ? (
            <Link
              href="/dashboard"
              className="ds-marketing-mobile-dashboard-link"
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
              ダッシュボード
            </Link>
          ) : (
            <Link
              href="/diagnosis"
              className="ds-marketing-diagnosis-link"
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
          )}
        </nav>
      </div>
      {!isAuthenticated ? (
        <div
          className="ds-marketing-mobile-login-bar"
          style={{
            display: "none",
            justifyContent: "center",
            padding: "8px 16px",
            borderTop: "1px solid #E5E9F0",
            background: "#fff",
          }}
        >
          <Link
            href="/login"
            style={{
              color: NAVY,
              fontSize: 13,
              fontWeight: 600,
              textDecoration: "none",
              padding: "6px 12px",
              borderRadius: 8,
              border: `1px solid ${NAVY}`,
            }}
          >
            ログイン
          </Link>
        </div>
      ) : null}
      <style>{`
        .ds-marketing-nav-link { display: none; }
        @media (min-width: 640px) {
          .ds-marketing-nav-link { display: inline-flex !important; }
        }
        @media (max-width: 639px) {
          .ds-marketing-mobile-login-bar { display: flex !important; }
        }
        .ds-marketing-login-link:focus-visible,
        .ds-marketing-diagnosis-link:focus-visible,
        .ds-marketing-mobile-dashboard-link:focus-visible,
        .ds-marketing-mobile-login-bar a:focus-visible {
          outline: 2px solid #2563EB;
          outline-offset: 2px;
        }
      `}</style>
    </header>
  );
}
