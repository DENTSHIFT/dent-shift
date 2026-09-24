import type { Metadata } from "next";
import Link from "next/link";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";
import { buildDiagnosisHref } from "./buildDiagnosisHref";
import styles from "../page.module.css";
import visualStyles from "./visual.module.css";

/**
 * SNS・広告・営業資料流入向けの画像主役LP(2026-09-24)。
 * 既存トップページ(src/app/page.tsx)は一切変更しない。テキスト量を抑え、
 * ダッシュボード風ビジュアルを主役にする。既存の配色トークン・CTAボタン・
 * カード等のクラスはpage.module.cssをそのまま再利用し、ブランドの一貫性を保つ。
 * 数値・実績はすべて「表示イメージ(サンプル)」であることを明示し、
 * 架空の実績・効果保証は一切含めない(docs/DENT_SHIFT_CLAUDE_HANDOFF.md 禁止事項準拠)。
 */

const SITE_URL = "https://dentshift.jp";
const CTA_LABEL = "無料でAI集患診断する";
const CTA_NOTE = "約60秒・クレジットカード不要";

export const metadata: Metadata = {
  title: "DENT SHIFT｜AI検索での見え方を60秒で診断",
  description:
    "歯科医院がChatGPT・Geminiなどのai検索でどう見えているかを無料診断。DENT SHIFTが競合との差と改善ポイントを可視化します。",
  alternates: { canonical: `${SITE_URL}/visual` },
  openGraph: {
    type: "website",
    url: `${SITE_URL}/visual`,
    title: "DENT SHIFT｜AI検索での見え方を60秒で診断",
    description: "歯科医院向けAI集患診断。無料・約60秒・クレジットカード不要。",
    siteName: "DENT SHIFT",
    locale: "ja_JP",
  },
};

const NAVY = "#0F1B2D";
const BLUE = "#2563EB";

function VisualHeader() {
  return (
    <header className={visualStyles.header}>
      <Link href="/" style={{ display: "inline-flex" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/logo/DENT_SHIFT_horizontal_tagline_transparent.png"
          alt="DENT SHIFT 歯科集患を、AIでシフトする。"
          width={1844}
          height={572}
          style={{ maxWidth: 120, height: "auto", display: "block" }}
        />
      </Link>
    </header>
  );
}

function FirstView({ diagnosisHref }: { diagnosisHref: string }) {
  return (
    <section className={visualStyles.fv}>
      <div className={visualStyles.fvInner}>
        <p className={styles.eyebrow}>歯科医院向けAI集患診断</p>
        <h1
          style={{
            margin: "10px 0 0",
            fontSize: 26,
            lineHeight: 1.45,
            color: NAVY,
            letterSpacing: "-0.02em",
            overflowWrap: "anywhere",
          }}
        >
          自院は、AIにどう見えている？
        </h1>
        <p style={{ margin: "12px 0 0", fontSize: 14, lineHeight: 1.8, color: "#4B5563" }}>
          ChatGPT・Geminiでの見え方を、約60秒で無料診断。
        </p>

        <div className={visualStyles.phoneFrame}>
          <span className={styles.mockLabel}>表示イメージ(サンプル)</span>

          <div className={visualStyles.chatRow}>
            <div className={visualStyles.chatBubbleUser}>
              患者の質問(例)：「駅前で入れ歯が得意な歯医者はありますか？」
            </div>
          </div>

          <div className={visualStyles.chatRow}>
            <div className={visualStyles.chatBubbleAi}>
              <p style={{ margin: 0, fontSize: 10, fontWeight: 800, color: "#9CA3AF", letterSpacing: "0.04em" }}>
                AIの回答(例)
              </p>
              <ol style={{ margin: "8px 0 0", padding: "0 0 0 18px", fontSize: 12.5, color: NAVY, lineHeight: 1.9 }}>
                <li>○○歯科医院 — 入れ歯治療の症例が多い</li>
                <li>△△デンタルクリニック — 保険診療に対応</li>
              </ol>
              <div className={visualStyles.missingTag}>
                貴院がどう比較されているか、診断で確認できます
              </div>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 24, width: "100%" }}>
          <Link href={diagnosisHref} className={`${styles.ctaButton} ${styles.ctaButtonFull}`}>
            {CTA_LABEL}
          </Link>
          <p style={{ color: "#6B7280", fontSize: 12, margin: "10px 0 0" }}>{CTA_NOTE}</p>
        </div>
      </div>
    </section>
  );
}

function PainPoints() {
  const items = [
    { icon: "🔍", text: "検索順位は良いのに、AI検索では自院が出てこない" },
    { icon: "💬", text: "口コミは集めているのに、AIに推薦されている実感がない" },
    { icon: "🤔", text: "何から改善すべきか、勘に頼ってしまっている" },
  ];
  return (
    <section className={styles.sectionTight}>
      <p className={styles.eyebrow}>こんなお悩みはありませんか？</p>
      <div className={visualStyles.painGrid}>
        {items.map((item) => (
          <div key={item.text} className={styles.card} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            <span style={{ fontSize: 22, lineHeight: 1 }}>{item.icon}</span>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.7, color: NAVY, fontWeight: 700 }}>{item.text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function WhatDiagnosisShows() {
  const domains = [
    { label: "MEO", desc: "Googleマップでの見え方" },
    { label: "SEO", desc: "検索順位の状況" },
    { label: "LLMO", desc: "AI検索での引用されやすさ" },
    { label: "AIO", desc: "ChatGPT等での推薦状況" },
    { label: "口コミ", desc: "件数・鮮度・返信状況" },
    { label: "予約導線", desc: "予約のしやすさ" },
  ];
  return (
    <section className={styles.section}>
      <p className={styles.eyebrow}>診断で見えること</p>
      <h2 className={styles.heading}>6つの領域を、まとめて可視化。</h2>
      <div className={styles.mockFrame} style={{ marginTop: 20 }}>
        <span className={styles.mockLabel}>表示イメージ(サンプル)</span>
        <div className={visualStyles.domainGrid}>
          {domains.map((d) => (
            <div key={d.label} className={visualStyles.domainCell}>
              <p style={{ margin: 0, fontSize: 12, fontWeight: 800, color: BLUE }}>{d.label}</p>
              <p style={{ margin: "4px 0 0", fontSize: 11, color: "#6B7280", lineHeight: 1.6 }}>{d.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ResultImage() {
  const tasks = ["口コミへの返信を増やす", "症例ページの情報を拡充する", "予約ページの導線を見直す"];
  return (
    <section className={styles.sectionTight}>
      <p className={styles.eyebrow}>結果イメージ</p>
      <h2 className={styles.heading}>改善の優先順位まで、その場で分かる。</h2>
      <div className={styles.mockFrame} style={{ marginTop: 20 }}>
        <span className={styles.mockLabel}>表示イメージ(サンプル)</span>
        <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
          {tasks.map((task, i) => (
            <div key={task} style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span
                style={{
                  flexShrink: 0,
                  width: 24,
                  height: 24,
                  borderRadius: "50%",
                  background: i === 0 ? BLUE : "#E5E9F0",
                  color: i === 0 ? "#fff" : "#6B7280",
                  fontSize: 12,
                  fontWeight: 800,
                  display: "grid",
                  placeItems: "center",
                }}
              >
                {i + 1}
              </span>
              <p style={{ margin: 0, fontSize: 13, color: NAVY, fontWeight: 700, overflowWrap: "anywhere" }}>{task}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function TrustSection() {
  const items = [
    "歯科医院専門のAI集患SaaS",
    "ChatGPT・Gemini・Google AIを横断分析",
    "登録は約60秒・クレジットカード不要",
  ];
  return (
    <section className={styles.sectionTight}>
      <div className={styles.pillRow} style={{ marginTop: 0, justifyContent: "center" }}>
        {items.map((t) => (
          <span key={t} className={styles.pill}>
            {t}
          </span>
        ))}
      </div>
      <p style={{ textAlign: "center", margin: "16px 0 0", fontSize: 11, color: "#9CA3AF" }}>
        <Link href="/legal/privacy" style={{ color: "#9CA3AF" }}>
          個人情報の取り扱いについて
        </Link>
      </p>
    </section>
  );
}

function FinalCta({ diagnosisHref }: { diagnosisHref: string }) {
  return (
    <section className={styles.sectionTight}>
      <div
        style={{
          boxSizing: "border-box",
          width: "100%",
          minWidth: 0,
          border: "1px solid #E5E9F0",
          borderRadius: 18,
          background: "#F5F7FA",
          padding: "32px 20px",
          textAlign: "center",
        }}
      >
        <h2 className={styles.heading}>まずは無料で、自院の現在地を確認。</h2>
        <div style={{ marginTop: 20 }}>
          <Link href={diagnosisHref} className={styles.ctaButton}>
            {CTA_LABEL}
          </Link>
        </div>
        <p style={{ color: "#6B7280", fontSize: 12, margin: "12px 0 0" }}>{CTA_NOTE}</p>
      </div>
    </section>
  );
}

export default async function VisualLandingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = await searchParams;
  const diagnosisHref = buildDiagnosisHref(resolvedSearchParams);

  return (
    <>
      <VisualHeader />
      <FirstView diagnosisHref={diagnosisHref} />
      <PainPoints />
      <WhatDiagnosisShows />
      <ResultImage />
      <TrustSection />
      <FinalCta diagnosisHref={diagnosisHref} />
      <MarketingFooter />
    </>
  );
}
