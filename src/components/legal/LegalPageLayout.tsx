import { notFound } from "next/navigation";
import Link from "next/link";
import { MarketingHeader } from "@/components/marketing/MarketingHeader";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";
import { isLegalPagePubliclyVisible, type LegalPageDefinition } from "@/domain/legal/legalPages";

const NAVY = "#0F1B2D";
const MUTED = "#6B7280";

/**
 * 法務ページ共通レイアウト(2026-09-23最終修正)。見出し・更新日・本文セクションの構造のみを
 * 提供する。承認済み本文(approvedBody)が無い間は「内容未確定」であることを明示し、
 * 断定的な法的文言をこのコンポーネント自身が生成することはない。
 *
 * 重要(2026-09-23のユーザー指示): noindexはアクセス制御ではない。本番環境
 * (NODE_ENV==="production" — next start/実デプロイ時にNext.jsが自動設定する値。
 * 他の既存箇所(session.ts等)と同じ判定基準を踏襲する)では、承認済み本文が無いページへの
 * 直接アクセスを404として扱う。開発環境(next dev)では引き続き「内容未確定」画面を
 * 確認できる状態を維持する。
 */
export function LegalPageLayout({ page }: { page: LegalPageDefinition }) {
  if (process.env.NODE_ENV === "production" && !isLegalPagePubliclyVisible(page)) {
    notFound();
  }

  return (
    <>
      <MarketingHeader />
      <main style={{ background: "#fff", minHeight: "60vh" }}>
        <div style={{ maxWidth: 720, margin: "0 auto", padding: "48px 20px 80px" }}>
          <p style={{ margin: 0, fontSize: 12, color: MUTED }}>
            <Link href="/" style={{ color: MUTED }}>
              トップ
            </Link>
            {" / "}
            {page.title}
          </p>
          <h1 style={{ margin: "10px 0 0", fontSize: 26, color: NAVY }}>{page.title}</h1>
          <p style={{ margin: "8px 0 0", fontSize: 12, color: MUTED }}>
            {page.updatedAt ? `最終更新日: ${page.updatedAt}` : "最終更新日: 未定(本文未確定)"}
          </p>

          {page.approvedBody ? (
            <div style={{ marginTop: 32, fontSize: 14, color: "#374151", lineHeight: 1.9, whiteSpace: "pre-wrap" }}>
              {page.approvedBody}
            </div>
          ) : (
            <>
              <div
                style={{
                  marginTop: 28,
                  padding: "16px 18px",
                  border: "1px solid #FDE68A",
                  background: "#FFFBEB",
                  borderRadius: 12,
                }}
              >
                <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#92400E" }}>
                  このページの内容は未確定です
                </p>
                <p style={{ margin: "6px 0 0", fontSize: 12, color: "#92400E", lineHeight: 1.7 }}>
                  正式な文面は法務確認後に掲載します。以下は、掲載にあたって確認が必要な項目の一覧です。
                  推測や仮の内容は記載していません。
                </p>
              </div>

              {page.section.verifiedFromCode.length > 0 && (
                <section style={{ marginTop: 24 }}>
                  <h2 style={{ fontSize: 14, color: NAVY, margin: 0 }}>コード上で確認できている事実</h2>
                  <ul style={{ margin: "10px 0 0", paddingLeft: 20, display: "grid", gap: 6 }}>
                    {page.section.verifiedFromCode.map((fact) => (
                      <li key={fact} style={{ fontSize: 13, color: "#374151", lineHeight: 1.7 }}>
                        {fact}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <section style={{ marginTop: 24 }}>
                <h2 style={{ fontSize: 14, color: NAVY, margin: 0 }}>掲載に必要な未確認項目(要確認)</h2>
                <ul style={{ margin: "10px 0 0", paddingLeft: 20, display: "grid", gap: 6 }}>
                  {page.section.missingFacts.map((fact) => (
                    <li key={fact} style={{ fontSize: 13, color: "#B45309", lineHeight: 1.7 }}>
                      要確認: {fact}
                    </li>
                  ))}
                </ul>
              </section>
            </>
          )}

          <p style={{ marginTop: 40 }}>
            <Link href="/" style={{ fontSize: 13, color: "#2563EB", textDecoration: "none" }}>
              トップに戻る
            </Link>
          </p>
        </div>
      </main>
      <MarketingFooter />
    </>
  );
}
