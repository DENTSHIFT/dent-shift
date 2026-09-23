import Link from "next/link";
import { MarketingHeader } from "@/components/marketing/MarketingHeader";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";
import { DiagnosisPreviewTabs } from "@/components/marketing/DiagnosisPreviewTabs";
import { PLAN_SUMMARIES } from "@/domain/billing/planCatalog";
import { PLAN_PRICE_LABELS } from "@/domain/billing/planPricing";
import styles from "./page.module.css";

const NAVY = "#0F1B2D";
const BLUE = "#2563EB";
const GOLD_BORDER = "#E4D6A7";
const GOLD_TEXT = "#7A5F1F";

const DIAGNOSIS_CTA_LABEL = "無料でAI集患診断する";
const DIAGNOSIS_CTA_NOTE = "約60秒・クレジットカード不要・診断結果をすぐ表示";

/**
 * 広告LP 最終修正版(2026-09-22)。優先順位:
 * 1) モバイル横方向オーバーフローの根絶(固定幅を持たせない、min-width:0、box-sizing統一)
 * 2) 無料診断CTAの文言統一
 * 3) 歯科専門サービスとしての信頼感(スペシャリスト3領域整理、誇張表現の排除)
 * 4) LP全体の縦の長さ削減(4つのプレビューセクションをタブへ統合)
 *
 * プロダクトUIのモック数値(FVミニダッシュボード、診断で分かる4つのこと、改善推移)は
 * すべて「表示イメージ/サンプル」であることを明記し、実測値と誤認させない。
 * 架空の医院数・改善率・監修者・導入実績は追加しない。
 */
export default function LandingPage() {
  return (
    <>
      <MarketingHeader />
      <main style={{ width: "100%", background: "#fff", overflowX: "hidden" }}>
        <FirstView />
        <WhatYouGet />
        <FreeDiagnosisCta />
        <DiagnosisPreviewSection />
        <WhyLosing />
        <CrossDomainAnalysis />
        <AiToBookingFunnel />
        <ImprovementTrendPreview />
        <PricingSection />
        <SpecialistTeamSection />
        <ComparisonTableSection />
        <FreeVsPaidSection />
        <NoSalesCallSection />
        <OnboardingFlowSection />
        <FaqSection />
        <FinalCtaSection />
      </main>
      <MarketingFooter />
    </>
  );
}

/* 1. ファーストビュー */
function FirstView() {
  return (
    <section className={styles.fv}>
      <div className={styles.fvInner}>
        <div style={{ minWidth: 0 }}>
          <p className={styles.eyebrow}>Google検索から、AI検索へ。</p>
          <h1 style={{ margin: "10px 0 0", fontSize: 30, lineHeight: 1.4, color: NAVY, letterSpacing: "-0.02em", overflowWrap: "anywhere" }}>
            AIに選ばれる歯科医院へ。
          </h1>
          <p style={{ margin: "16px 0 0", fontSize: 14, lineHeight: 1.85, color: "#4B5563", maxWidth: 480, overflowWrap: "anywhere" }}>
            ChatGPT・Gemini・Google AIでの見え方を診断し、競合との差と改善TOP3を約60秒で可視化します。
          </p>
          <div style={{ marginTop: 24 }}>
            <Link href="/diagnosis" className={`${styles.ctaButton} ${styles.ctaButtonFull}`}>
              {DIAGNOSIS_CTA_LABEL}
            </Link>
            <p style={{ color: "#6B7280", fontSize: 12, margin: "12px 0 0", lineHeight: 1.6 }}>{DIAGNOSIS_CTA_NOTE}</p>
          </div>
        </div>

        <div className={styles.mockFrame}>
          <span className={styles.mockLabel}>表示イメージ(サンプル)</span>
          <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div
                style={{
                  width: 60,
                  height: 60,
                  flexShrink: 0,
                  borderRadius: "50%",
                  background: `conic-gradient(${BLUE} 62%, #E5E9F0 0)`,
                  display: "grid",
                  placeItems: "center",
                }}
              >
                <div style={{ width: 44, height: 44, borderRadius: "50%", background: "#fff", display: "grid", placeItems: "center" }}>
                  <span style={{ fontSize: 15, fontWeight: 800, color: NAVY }}>62</span>
                </div>
              </div>
              <div style={{ minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 12, color: "#6B7280" }}>AI集患総合スコア</p>
                <p style={{ margin: "2px 0 0", fontSize: 11, color: "#9CA3AF" }}>62 / 100点</p>
              </div>
            </div>
            <div className={`${styles.cardGrid} ${styles.cardGrid2}`} style={{ marginTop: 0, gap: 10 }}>
              <div className={styles.card} style={{ padding: 12 }}>
                <p style={{ margin: 0, fontSize: 11, color: "#6B7280" }}>AIに選ばれている割合</p>
                <p style={{ margin: "4px 0 0", fontSize: 18, fontWeight: 800, color: NAVY }}>18%</p>
              </div>
              <div className={styles.card} style={{ padding: 12 }}>
                <p style={{ margin: 0, fontSize: 11, color: "#6B7280" }}>競合優勢の質問</p>
                <p style={{ margin: "4px 0 0", fontSize: 18, fontWeight: 800, color: NAVY }}>3件</p>
              </div>
            </div>
            <div className={styles.card} style={{ padding: 12 }}>
              <p style={{ margin: 0, fontSize: 11, color: "#6B7280" }}>改善優先度TOP1</p>
              <p style={{ margin: "4px 0 0", fontSize: 13, fontWeight: 700, color: NAVY, overflowWrap: "anywhere" }}>
                インプラント症例情報の拡充
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* 2. DENT SHIFTで何が分かるか */
function WhatYouGet() {
  const items = [
    { title: "AI集患スコア", desc: "自院がAIにどう見えているかを100点満点で可視化" },
    { title: "AIで選ばれている割合", desc: "患者質問のうち自院が優位に推薦された割合" },
    { title: "患者質問ごとの勝ち負け", desc: "質問単位で自院と競合の推薦状況を比較" },
    { title: "近隣競合との差", desc: "商圏内の競合医院と何が違うのかを整理" },
    { title: "強み・弱み", desc: "AIがどの情報を評価し、何が不足しているか" },
    { title: "改善TOP3", desc: "次に取り組むべき改善を優先順位付きで表示" },
  ];
  return (
    <section id="what-you-get" className={styles.section}>
      <p className={styles.eyebrow}>無料診断で、ここまで分かります。</p>
      <h2 className={styles.heading}>DENT SHIFTで何が分かるか</h2>
      <div className={`${styles.cardGrid} ${styles.cardGrid3}`}>
        {items.map((item) => (
          <div key={item.title} className={styles.card}>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: NAVY }}>{item.title}</p>
            <p style={{ margin: "8px 0 0", fontSize: 13, color: "#6B7280", lineHeight: 1.7 }}>{item.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* 3. 無料AI診断CTA */
function FreeDiagnosisCta() {
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
        <p className={styles.eyebrow}>まずは無料で、自院の現在地を確認。</p>
        <h2 className={styles.heading} style={{ marginTop: 8 }}>
          無料AI集患診断
        </h2>
        <p className={styles.sub} style={{ margin: "10px auto 0" }}>
          医院名・院長名・医院URL・メールアドレス・電話番号を入力するだけ。約60秒で結果が表示されます。
        </p>
        <div style={{ marginTop: 20 }}>
          <Link href="/diagnosis" className={styles.ctaButton}>
            {DIAGNOSIS_CTA_LABEL}
          </Link>
        </div>
        <div className={styles.pillRow} style={{ justifyContent: "center" }}>
          {DIAGNOSIS_CTA_NOTE.split("・").map((t) => (
            <span key={t} className={styles.pill}>
              {t}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

/* 4. 診断で分かる4つのこと(旧: 診断結果イメージ/AI推薦シェア/患者質問/改善TOP3の4セクションを統合) */
function DiagnosisPreviewSection() {
  return (
    <section className={styles.section}>
      <p className={styles.eyebrow}>診断で分かる4つのこと</p>
      <h2 className={styles.heading}>「無料なのにここまで分かる」を、実際の画面で。</h2>
      <p className={styles.sub}>タブを切り替えて、診断結果の見え方をご確認いただけます。</p>
      <DiagnosisPreviewTabs />
    </section>
  );
}

/* なぜ負けているのか(簡潔に) */
function WhyLosing() {
  const reasons = ["症例ページの情報不足", "FAQ情報不足", "Google口コミの件数・鮮度", "院長プロフィールの専門情報不足"];
  return (
    <section className={styles.sectionTight}>
      <h2 className={styles.heading} style={{ fontSize: 18 }}>
        大切なのは、順位ではなく「理由」です。
      </h2>
      <div className={styles.pillRow} style={{ justifyContent: "flex-start" }}>
        {reasons.map((r) => (
          <span key={r} className={styles.pill}>
            {r}
          </span>
        ))}
      </div>
    </section>
  );
}

/* 歯科集患の横断分析 */
function CrossDomainAnalysis() {
  const domains = ["AI検索", "SEO", "MEO", "医院サイト", "口コミ", "広告", "予約導線"];
  return (
    <section className={styles.sectionTight}>
      <h2 className={styles.heading} style={{ fontSize: 18 }}>
        歯科医院の集患は、AI検索だけ見ても分かりません。
      </h2>
      <div className={styles.pillRow} style={{ justifyContent: "flex-start" }}>
        {domains.map((d) => (
          <span key={d} className={styles.pill}>
            {d}
          </span>
        ))}
      </div>
    </section>
  );
}

/* AIから予約まで */
function AiToBookingFunnel() {
  const steps = ["AI推薦", "サイト流入", "診療ページ", "予約CTA", "予約完了"];
  return (
    <section className={styles.sectionTight}>
      <h2 className={styles.heading} style={{ fontSize: 18 }}>
        AIから予約まで、まとめて見る。
      </h2>
      <div
        style={{
          marginTop: 20,
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 8,
          justifyContent: "flex-start",
        }}
      >
        {steps.map((step, i) => (
          <div key={step} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: NAVY,
                background: "#F5F7FA",
                border: "1px solid #E5E9F0",
                borderRadius: 999,
                padding: "8px 14px",
                whiteSpace: "nowrap",
              }}
            >
              {step}
            </span>
            {i < steps.length - 1 && <span style={{ color: "#9CA3AF" }}>→</span>}
          </div>
        ))}
      </div>
    </section>
  );
}

/* 改善推移 */
function ImprovementTrendPreview() {
  const points = [62, 69, 78];
  return (
    <section className={styles.sectionTight}>
      <h2 className={styles.heading} style={{ fontSize: 18 }}>
        診断 → 改善 → 再計測 → 次の改善
      </h2>
      <div className={styles.mockFrame}>
        <span className={styles.mockLabel}>表示イメージ(サンプル)</span>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 20, marginTop: 14, justifyContent: "center" }}>
          {points.map((p, i) => (
            <div key={i} style={{ textAlign: "center" }}>
              <div
                style={{
                  width: 44,
                  height: p * 0.8,
                  background: i === points.length - 1 ? BLUE : "#CBD5E1",
                  borderRadius: "6px 6px 0 0",
                  margin: "0 auto",
                }}
              />
              <p style={{ margin: "6px 0 0", fontSize: 13, fontWeight: 800, color: NAVY }}>{p}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* 料金 */
function PricingSection() {
  const targetCopy: Record<string, string> = {
    light: "こんな医院向け:まずは現状把握から始めたい",
    standard: "こんな医院向け:保険診療の新患を増やしたい",
    premium: "こんな医院向け:自費診療の集患を強化したい",
  };
  const ctaCopy: Record<string, string> = {
    light: "無料診断から始める",
    standard: "このプランを相談する",
    premium: "このプランを相談する",
  };
  return (
    <section id="pricing" className={styles.section}>
      <p className={styles.eyebrow}>料金は、この3つだけ。</p>
      <h2 className={styles.heading}>シンプルな月額サブスクリプション</h2>
      <div className={styles.priceGrid}>
        {PLAN_SUMMARIES.map((plan) => (
          <div key={plan.id} className={`${styles.priceCard} ${plan.recommended ? styles.priceCardPopular : ""}`}>
            {plan.recommended && <span className={styles.popularBadge}>人気</span>}
            <p style={{ margin: 0, fontSize: 15, fontWeight: 800, color: NAVY }}>{plan.name}</p>
            <div>
              <p style={{ margin: 0, fontSize: 26, fontWeight: 800, color: NAVY, lineHeight: 1.3 }}>
                {PLAN_PRICE_LABELS[plan.id].replace("（税込）", "")}
              </p>
              <p style={{ margin: "2px 0 0", fontSize: 12, color: "#6B7280" }}>（税込）・初期費用0円</p>
            </div>
            <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: GOLD_TEXT }}>{targetCopy[plan.id]}</p>
            <div style={{ display: "grid", gap: 6 }}>
              {plan.highlights.map((h) => (
                <p key={h} style={{ margin: 0, fontSize: 12, color: NAVY, display: "flex", gap: 6 }}>
                  <span aria-hidden="true">✓</span>
                  <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{h}</span>
                </p>
              ))}
            </div>
            <Link
              href="/diagnosis"
              className={plan.recommended ? `${styles.ctaButton} ${styles.ctaButtonFull}` : `${styles.ctaButtonOutline} ${styles.ctaButtonFull}`}
              style={{ marginTop: "auto" }}
            >
              {ctaCopy[plan.id]}
            </Link>
          </div>
        ))}
      </div>
      <p style={{ marginTop: 20, fontSize: 12, color: "#6B7280", textAlign: "center" }}>
        月額サブスクリプション・契約期間の縛りなし・いつでも解約可能
      </p>
      <div style={{ textAlign: "center", marginTop: 14 }}>
        <Link href="/plans" style={{ color: BLUE, fontSize: 13, fontWeight: 700, textDecoration: "none" }}>
          プランの機能を詳しく比較する
        </Link>
      </div>
    </section>
  );
}

/* スペシャリストチーム */
function SpecialistTeamSection() {
  const groups = [
    { title: "AI検索・SEO・MEO", items: ["ChatGPT/Gemini等でのAI検索対策", "SEO", "MEO(地図検索)"] },
    { title: "診療別集患", items: ["保険診療の新患集患", "自費診療の集患"] },
    { title: "医院サイト・導線", items: ["医院サイト", "口コミ", "予約導線"] },
  ];
  return (
    <section className={styles.sectionTight}>
      <div className={styles.goldCard}>
        <p style={{ margin: 0, fontSize: 12, fontWeight: 800, color: GOLD_TEXT }}>DENT SHIFT スペシャリストチーム</p>
        <h2 style={{ margin: "8px 0 0", fontSize: 19, color: NAVY, overflowWrap: "anywhere" }}>
          歯科集患を理解した専門チームが伴走
        </h2>
        <p style={{ margin: "10px 0 0", fontSize: 13, color: "#6B7280", lineHeight: 1.8 }}>
          診断結果の読み解きから、診療メニュー別の改善優先順位、医院サイト・口コミ・予約導線の改善まで支援します。
        </p>
        <div className={`${styles.cardGrid} ${styles.cardGrid3}`} style={{ marginTop: 18 }}>
          {groups.map((group) => (
            <div
              key={group.title}
              style={{
                background: "#fff",
                border: `1px solid ${GOLD_BORDER}`,
                borderRadius: 12,
                padding: 14,
                minWidth: 0,
              }}
            >
              <p style={{ margin: 0, fontSize: 12, fontWeight: 800, color: NAVY }}>{group.title}</p>
              <div style={{ marginTop: 8, display: "grid", gap: 4 }}>
                {group.items.map((item) => (
                  <p key={item} style={{ margin: 0, fontSize: 12, color: "#6B7280", overflowWrap: "anywhere" }}>
                    ・{item}
                  </p>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p style={{ margin: "18px 0 0", fontSize: 11, color: "#9CA3AF" }}>
          ※オンライン完結型のサポート体制です。営業電話は行いません。
        </p>
      </div>
    </section>
  );
}

/* 比較表: デスクトップは表、モバイルは縦型カード */
function ComparisonTableSection() {
  const rows: { feature: string; dentShift: string; seo: string; selfDo: string }[] = [
    { feature: "初期費用", dentShift: "0円", seo: "サービスにより異なる", selfDo: "0円" },
    { feature: "料金体系", dentShift: "月額サブスク", seo: "サービスにより異なる", selfDo: "院内での設計・運用が必要" },
    { feature: "歯科医院特化", dentShift: "特化", seo: "対応範囲を要確認", selfDo: "自院での知見が必要" },
    { feature: "AI検索可視化", dentShift: "対応", seo: "対応範囲を要確認", selfDo: "把握が難しい" },
    { feature: "近隣競合比較", dentShift: "対応", seo: "対応範囲を要確認", selfDo: "把握しづらい" },
    { feature: "改善TOP3", dentShift: "自動提示", seo: "サービスにより異なる", selfDo: "自分で判断" },
    { feature: "継続モニタリング", dentShift: "対応", seo: "契約内容による", selfDo: "対応が難しい" },
    { feature: "契約期間", dentShift: "縛りなし", seo: "契約内容による", selfDo: "なし" },
    { feature: "解約", dentShift: "いつでも可能", seo: "契約内容による", selfDo: "なし" },
    { feature: "スペシャリスト相談", dentShift: "対応", seo: "オプションの場合が多い", selfDo: "対応が難しい" },
  ];
  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>他の方法と比べてみる</h2>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>比較項目</th>
              <th className={styles.tableHighlightCol}>✓ DENT SHIFT</th>
              <th>一般的なSEO／LLMO支援</th>
              <th>自力対策</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.feature}>
                <td>{row.feature}</td>
                <td className={styles.tableHighlightCol} style={{ fontWeight: 700 }}>
                  {row.dentShift}
                </td>
                <td>{row.seo}</td>
                <td>{row.selfDo}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className={styles.compareCards}>
          {rows.map((row) => (
            <div key={row.feature} className={styles.compareCard}>
              <p style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 800, color: NAVY }}>{row.feature}</p>
              <div className={styles.compareRow}>
                <span style={{ color: BLUE, fontWeight: 700 }}>✓ DENT SHIFT</span>
                <span style={{ fontWeight: 700, color: NAVY }}>{row.dentShift}</span>
              </div>
              <div className={styles.compareRow}>
                <span style={{ color: "#6B7280" }}>一般的なSEO／LLMO支援</span>
                <span>{row.seo}</span>
              </div>
              <div className={styles.compareRow}>
                <span style={{ color: "#6B7280" }}>自力対策</span>
                <span>{row.selfDo}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* 無料診断と有料版の違い */
function FreeVsPaidSection() {
  return (
    <section className={styles.section}>
      <p className={styles.eyebrow}>まずは無料で確認。必要だと思ったら、その先へ。</p>
      <h2 className={styles.heading}>現状把握は無料。改善の実行支援は有料。</h2>
      <div className={`${styles.cardGrid} ${styles.cardGrid2}`}>
        <div className={styles.card}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: NAVY }}>無料でわかること</p>
          <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
            {["AI集患総合スコア", "AIに選ばれている割合", "競合との差", "改善優先度TOP3"].map((t) => (
              <p key={t} style={{ margin: 0, fontSize: 13, color: "#6B7280" }}>
                ・{t}
              </p>
            ))}
          </div>
        </div>
        <div className={styles.card} style={{ border: `1.5px solid ${BLUE}` }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: NAVY }}>有料プランでできること</p>
          <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
            {["詳細な原因分析", "診療メニュー別の改善提案", "競合医院の継続モニタリング", "改善アクション管理", "改善前後の比較", "スペシャリスト相談"].map(
              (t) => (
                <p key={t} style={{ margin: 0, fontSize: 13, color: "#6B7280" }}>
                  ・{t}
                </p>
              )
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/* 営業電話なし */
function NoSalesCallSection() {
  return (
    <section className={styles.sectionTight}>
      <div className={styles.card} style={{ textAlign: "center" }}>
        <p className={styles.eyebrow}>Sales Without Salespeople.</p>
        <h2 className={styles.heading} style={{ marginTop: 8, fontSize: 18 }}>
          営業電話は、一切いたしません。
        </h2>
        <p className={styles.sub} style={{ margin: "10px auto 0" }}>
          無料診断後に、こちらから営業電話を行うことはありません。ご希望の場合のみ、相談をご利用いただけます。
        </p>
      </div>
    </section>
  );
}

/* 導入フロー */
function OnboardingFlowSection() {
  const steps = ["無料AI診断", "診断結果確認", "料金・プラン確認", "SMS認証・メール認証", "カード登録", "7日間無料トライアル", "ダッシュボード利用開始"];
  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>導入フロー</h2>
      <div className={`${styles.cardGrid} ${styles.cardGrid4}`}>
        {steps.map((step, i) => (
          <div key={step} className={styles.card} style={{ padding: 14 }}>
            <p style={{ margin: 0, fontSize: 11, color: BLUE, fontWeight: 800 }}>STEP {String(i + 1).padStart(2, "0")}</p>
            <p style={{ margin: "6px 0 0", fontSize: 13, color: NAVY, fontWeight: 700, overflowWrap: "anywhere" }}>{step}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* FAQ: カテゴリ整理 + 初期表示5件強調 */
function FaqSection() {
  const categories: { label: string; items: { q: string; a: string }[] }[] = [
    {
      label: "無料診断について",
      items: [
        { q: "本当に無料で診断できますか？", a: "はい。無料AI集患診断は、クレジットカード登録不要でご利用いただけます。" },
        { q: "診断結果はどのように算出しますか？", a: "ChatGPT・Gemini・Google AIなど主要なAIへ患者質問を投げかけた結果と、医院サイト・GBP等の公開情報をもとに算出します。測定できていない項目は0点として扱わず、別に区別して表示します。" },
      ],
    },
    {
      label: "入力情報・電話番号について",
      items: [
        { q: "電話番号は何に使いますか？", a: "なりすまし登録を防ぐためのSMS認証にのみ使用します。営業電話のためにお電話することはありません。" },
        { q: "営業電話はありますか？", a: "こちらからの営業電話は一切行いません。ご希望の方のみ、スペシャリストへの相談を予約いただけます。" },
      ],
    },
    {
      label: "料金・契約・解約について",
      items: [
        { q: "クレジットカードはいつ必要ですか？", a: "7日間無料トライアルを開始する際にご登録いただきます。診断だけであれば不要です。" },
        { q: "契約期間の縛りはありますか？", a: "ありません。月額サブスクリプションで、いつでも解約いただけます。" },
        { q: "いつでも解約できますか？", a: "はい。ダッシュボードからいつでも解約手続きが可能です。" },
        { q: "トライアル後の課金はどうなりますか？", a: "7日間の無料期間終了後、8日目から選択したプランの月額課金が開始されます。開始前に金額と日付を明示します。" },
      ],
    },
    {
      label: "診断範囲・対応AIについて",
      items: [
        { q: "どのAIサービスに対応していますか？", a: "ChatGPT・Gemini・Google AIなど主要なAIでの見え方を確認できます。" },
        { q: "競合医院との比較はできますか？", a: "近隣の競合医院との差や、患者質問ごとの勝ち負けを確認できます。" },
      ],
    },
    {
      label: "サポートについて",
      items: [{ q: "スペシャリストに相談できますか？", a: "診断結果の読み解みや改善優先順位について、オンラインで相談いただけます。" }],
    },
  ];

  // 2026-09-22最終修正: 重要度の高い5件を上位に強調表示する。文言・回答は
  // 下のカテゴリ内の同一項目と同じもの(新規コピーは作らない)。
  const featuredQuestions = new Set([
    "本当に無料で診断できますか？",
    "電話番号は何に使いますか？",
    "営業電話はありますか？",
    "どのAIサービスに対応していますか？",
    "診断結果はどのように算出しますか？",
  ]);
  const featured = categories.flatMap((cat) => cat.items).filter((item) => featuredQuestions.has(item.q));

  return (
    <section id="faq" className={styles.section}>
      <h2 className={styles.heading}>よくある質問</h2>

      <p className={styles.faqCategoryLabel} style={{ marginTop: 20 }}>
        よく寄せられる質問
      </p>
      <div style={{ display: "grid", gap: 8 }}>
        {featured.map((item) => (
          <FaqItem key={item.q} q={item.q} a={item.a} highlighted />
        ))}
      </div>

      <div style={{ marginTop: 8 }}>
        {categories.map((cat) => (
          <div key={cat.label}>
            <p className={styles.faqCategoryLabel}>{cat.label}</p>
            <div style={{ display: "grid", gap: 8 }}>
              {cat.items.map((item) => (
                <FaqItem key={item.q} q={item.q} a={item.a} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function FaqItem({ q, a, highlighted }: { q: string; a: string; highlighted?: boolean }) {
  return (
    <details
      className={styles.faqItem}
      open={highlighted}
      style={highlighted ? { borderColor: "#2563EB", borderWidth: 1.5 } : undefined}
    >
      <summary className={styles.faqButton}>
        <span style={{ minWidth: 0, overflowWrap: "anywhere", fontWeight: highlighted ? 800 : 700 }}>{q}</span>
      </summary>
      <p className={styles.faqAnswer}>{a}</p>
    </details>
  );
}

/* 最終CTA */
function FinalCtaSection() {
  return (
    <section className={styles.sectionTight}>
      <div
        style={{
          boxSizing: "border-box",
          width: "100%",
          minWidth: 0,
          border: "1px solid #E5E9F0",
          borderRadius: 18,
          background: NAVY,
          padding: "36px 20px",
          textAlign: "center",
        }}
      >
        <h2 style={{ margin: 0, fontSize: 21, color: "#fff", lineHeight: 1.6, overflowWrap: "anywhere" }}>
          まずは無料で、AI検索での現在地を確認。
        </h2>
        <p style={{ margin: "12px auto 0", fontSize: 13, color: "#CBD5E1", maxWidth: 480, lineHeight: 1.85 }}>
          AIに選ばれている患者ニーズ、競合との差、優先して直すべきポイントを約60秒で確認できます。
        </p>
        <div style={{ marginTop: 22 }}>
          <Link href="/diagnosis" className={`${styles.ctaButton} ${styles.ctaButtonFull}`}>
            {DIAGNOSIS_CTA_LABEL}
          </Link>
          <p style={{ color: "#9CA3AF", fontSize: 12, margin: "12px 0 0", lineHeight: 1.6 }}>
            約60秒・クレジットカード不要・営業電話なし
          </p>
        </div>
      </div>
    </section>
  );
}
