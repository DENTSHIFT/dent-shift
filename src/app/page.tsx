import Image from "next/image";
import Link from "next/link";
import { MarketingHeader } from "@/components/marketing/MarketingHeader";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";
import { DiagnosisPreviewTabs } from "@/components/marketing/DiagnosisPreviewTabs";
import { MobileStickyCta } from "@/components/marketing/MobileStickyCta";
import { PLAN_SUMMARIES, PLAN_FEATURE_ROWS } from "@/domain/billing/planCatalog";
import { PLAN_PRICE_LABELS } from "@/domain/billing/planPricing";
import styles from "./page.module.css";

const NAVY = "#0F1B2D";
const BLUE = "#2563EB";
const GOLD_TEXT = "#7A5F1F";

const DIAGNOSIS_CTA_LABEL = "無料でAI集患診断する";
const DIAGNOSIS_CTA_NOTE = "約60秒・クレジットカード不要・営業電話なし";

/**
 * 広告LP 完成版(2026-09-25)。ニコルのデザイン案(design/reference/lp, dashboard配下)と
 * 木村からの修正指示を反映。情報構成は「何が問題か→なぜ今必要か→何が分かるか→
 * 実画面→改善→料金→FAQ」の順に固定し、料金訴求を無料診断の価値訴求より前に出さない。
 *
 * 触っていない領域: Stripe/Subscription/Billing/Twilio Verify/smsVerificationExempt/
 * Pilot/isLifetimeFree/billingExempt/診断エンジン/診断メール/ops/Salesforce。
 * 料金・プラン仕様は src/domain/billing/planCatalog.ts を唯一の情報源とし、値を書き換えない。
 *
 * プロダクトUIのモック数値(診断プレビュータブ等)は「表示イメージ/サンプル」と明記し、
 * 実測値と誤認させない。実画面として使用しているダッシュボード画像はニコル提供の
 * design/reference/dashboard/ 配下のPNG(public/marketing/にコピー済み)。
 */
export default function LandingPage() {
  return (
    <>
      <MarketingHeader />
      <main style={{ width: "100%", background: "#fff", overflowX: "hidden" }}>
        <FirstView />
        <TrustBanner />
        <AboutSection />
        <BrandLineSection />
        <WhatYouGet />
        <RealDashboardSection />
        <DiagnosisPreviewSection />
        <AiToBookingFunnel />
        <FreeDiagnosisCta />
        <FreeVsPaidSection />
        <PricingSection />
        <SpecialistTeamSection />
        <NoSalesCallSection />
        <OnboardingFlowSection />
        <PlanComparisonSection />
        <FaqSection />
        <FinalCtaSection />
      </main>
      <MarketingFooter />
      <MobileStickyCta label={DIAGNOSIS_CTA_LABEL} />
    </>
  );
}

/* 1. ファーストビュー: 見出し・サブコピー・補足に階層をつけ、実ダッシュボード画像を主役にする */
function FirstView() {
  return (
    <section className={styles.fv}>
      <div className={styles.fvInner}>
        <div style={{ minWidth: 0 }}>
          <p className={styles.eyebrow}>Google検索から、AI検索へ。</p>
          <h1
            style={{
              margin: "10px 0 0",
              fontSize: 26,
              lineHeight: 1.45,
              color: NAVY,
              letterSpacing: "-0.02em",
              fontWeight: 800,
              overflowWrap: "anywhere",
            }}
          >
            患者様の情報収集は、Google検索だけでなくAI検索へ。
          </h1>
          <p
            style={{
              margin: "14px 0 0",
              fontSize: 17,
              lineHeight: 1.6,
              color: NAVY,
              fontWeight: 700,
              overflowWrap: "anywhere",
            }}
          >
            AI検索への対策、できていますか？
          </p>
          <p style={{ margin: "12px 0 0", fontSize: 13, lineHeight: 1.85, color: "#6B7280", maxWidth: 460, overflowWrap: "anywhere" }}>
            ChatGPT・Gemini・Google AIでの見え方を診断し、競合との差と改善TOP3を約60秒で可視化します。
          </p>

          <ul className={styles.fvChecklist}>
            <li>歯科医院向けAI集患サービス</li>
            <li>AI検索対策の現在地を可視化</li>
            <li>スコアで数値化・毎月モニタリング</li>
            <li>まずは無料で診断できます</li>
          </ul>

          <div style={{ marginTop: 24 }}>
            <Link href="/diagnosis" className={`${styles.ctaButton} ${styles.ctaButtonFull}`}>
              {DIAGNOSIS_CTA_LABEL}
            </Link>
            <p style={{ color: "#6B7280", fontSize: 12, margin: "12px 0 0", lineHeight: 1.6 }}>{DIAGNOSIS_CTA_NOTE}</p>
          </div>
        </div>

        <div className={styles.fvImageFrame}>
          <Image
            src="/marketing/dashboard-hero.png"
            alt="DENT SHIFT AI集患ダッシュボードの画面イメージ"
            width={1536}
            height={1024}
            priority
            sizes="(max-width: 960px) 100vw, 560px"
            className={styles.fvImage}
          />
        </div>
      </div>
    </section>
  );
}

/* 2. Google公式情報の小型信頼バナー(FV直下、主役にしない) */
function TrustBanner() {
  return (
    <section className={styles.sectionTight} style={{ paddingTop: 8, paddingBottom: 8 }}>
      <div className={styles.trustBanner}>
        <span className={styles.trustBannerIcon} aria-hidden="true">
          G
        </span>
        <div style={{ minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: NAVY, overflowWrap: "anywhere" }}>
            Google検索も、AI時代へ。
          </p>
          <p style={{ margin: "4px 0 0", fontSize: 11.5, color: "#6B7280", lineHeight: 1.7, overflowWrap: "anywhere" }}>
            2024年8月に「AIによる概要(AI Overviews)」を日本へ拡大、2025年9月にはGoogle検索の「AIモード」を日本語で提供開始しています。
          </p>
        </div>
      </div>
    </section>
  );
}

/* 3. DENT SHIFTとは */
function AboutSection() {
  return (
    <section className={styles.sectionTight}>
      <p className={styles.eyebrow}>DENT SHIFTとは</p>
      <h2 className={styles.heading} style={{ fontSize: 20 }}>
        歯科医院専用の、AI集患診断・改善サービスです。
      </h2>
      <p className={styles.sub}>
        ChatGPT・Gemini・Google AIなど主要なAIに、患者が実際に相談するような質問を投げかけ、自院がどう見えているかをスコアで可視化します。
        競合医院との差、改善すべき優先順位まで、無料診断だけで確認できます。
      </p>
    </section>
  );
}

/* 4. 感覚ではなく、データ分析で。 */
function BrandLineSection() {
  return (
    <section className={styles.sectionTight} style={{ paddingTop: 0 }}>
      <div className={styles.brandLine}>
        <p style={{ margin: 0, fontSize: 18, fontWeight: 800, color: NAVY, letterSpacing: "-0.01em" }}>
          感覚ではなく、データ分析で。
        </p>
      </div>
    </section>
  );
}

/* 5. 無料AI診断で何が分かるか */
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
      <h2 className={styles.heading}>無料AI診断で何が分かるか</h2>
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

/* 6. 実際の診断結果／ダッシュボード(実画面) */
function RealDashboardSection() {
  return (
    <section className={styles.section}>
      <p className={styles.eyebrow}>実際の画面で見る</p>
      <h2 className={styles.heading}>契約後は、このダッシュボードで毎月の改善が分かります。</h2>
      <p className={styles.sub}>AI集患総合スコア・スコア推移・エリア内競合比較・改善アクションを1画面で確認できます。</p>
      <div className={styles.mockFrame} style={{ padding: 12 }}>
        <Image
          src="/marketing/dashboard-onboarding.png"
          alt="DENT SHIFTダッシュボードの実際の画面"
          width={1536}
          height={1024}
          sizes="(max-width: 900px) 100vw, 1032px"
          className={styles.imgResponsive}
        />
      </div>
    </section>
  );
}

/* 7. AI推薦シェア・患者質問の勝ち負け・改善TOP3(診断で分かる4つのこと) */
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

/* 8. AI→サイト→予約までの分析 */
function AiToBookingFunnel() {
  const steps = ["AI推薦", "サイト流入", "診療ページ", "予約CTA", "予約完了"];
  return (
    <section className={styles.sectionTight}>
      <h2 className={styles.heading} style={{ fontSize: 18 }}>
        AIから予約まで、まとめて見る。
      </h2>
      <div style={{ marginTop: 20, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
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

/* 9. 無料診断CTA(入力項目は確定仕様: 電話番号のみ任意) */
function FreeDiagnosisCta() {
  return (
    <section className={styles.sectionTight}>
      <div className={styles.ctaPanel}>
        <p className={styles.eyebrow}>まずは無料で、自院の現在地を確認。</p>
        <h2 className={styles.heading} style={{ marginTop: 8 }}>
          無料AI集患診断
        </h2>
        <p className={styles.sub} style={{ margin: "10px auto 0" }}>
          医院名・院長名・医院URL・メールアドレスをご入力ください(電話番号は任意)。約60秒で結果が表示されます。
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

/* 10. 有料版でできること */
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

/* 11. 3料金プラン: ライト=淡いグレー/ブルー、スタンダード=ネイビー(推奨・最も目立つ)、プレミアム=ゴールド */
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
  const tone: Record<string, string> = {
    light: styles.priceCardLight ?? "",
    standard: styles.priceCardStandard ?? "",
    premium: styles.priceCardPremium ?? "",
  };
  return (
    <section id="pricing" className={styles.section}>
      <p className={styles.eyebrow}>料金は、この3つだけ。</p>
      <h2 className={styles.heading}>シンプルな月額サブスクリプション</h2>
      <div className={styles.priceGrid}>
        {PLAN_SUMMARIES.map((plan) => (
          <div key={plan.id} className={`${styles.priceCard} ${tone[plan.id]}`}>
            {plan.recommended && <span className={styles.popularBadge}>おすすめ</span>}
            <p style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>{plan.name}</p>
            <div>
              <p style={{ margin: 0, fontSize: 26, fontWeight: 800, lineHeight: 1.3 }}>
                {PLAN_PRICE_LABELS[plan.id].replace("（税込）", "")}
              </p>
              <p className={styles.priceSubLabel}>（税込）・初期費用0円</p>
            </div>
            <p className={styles.priceTargetCopy}>{targetCopy[plan.id]}</p>
            <div style={{ display: "grid", gap: 6 }}>
              {plan.highlights.map((h) => (
                <p key={h} style={{ margin: 0, fontSize: 12, display: "flex", gap: 6 }}>
                  <span aria-hidden="true">✓</span>
                  <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{h}</span>
                </p>
              ))}
            </div>
            <Link
              href="/diagnosis"
              className={plan.id === "light" ? `${styles.ctaButtonOutline} ${styles.ctaButtonFull}` : `${styles.ctaButtonLight} ${styles.ctaButtonFull}`}
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

/* 12. スペシャリストサポート */
function SpecialistTeamSection() {
  const groups = [
    { title: "AI検索・SEO・MEO", items: ["ChatGPT/Gemini等でのAI検索対策", "SEO", "MEO(地図検索)"] },
    { title: "診療別集患", items: ["保険診療の新患集患", "自費診療の集患"] },
    { title: "医院サイト・導線", items: ["医院サイト", "口コミ", "予約導線"] },
  ];
  return (
    <section className={styles.sectionTight}>
      <div className={styles.goldCard}>
        <p style={{ margin: 0, fontSize: 12, fontWeight: 800, color: GOLD_TEXT }}>DENT SHIFT スペシャリストサポート</p>
        <h2 style={{ margin: "8px 0 0", fontSize: 19, color: NAVY, overflowWrap: "anywhere" }}>
          AIだけで完結させず、歯科集患を理解した専門チームが伴走します。
        </h2>
        <p style={{ margin: "10px 0 0", fontSize: 13, color: "#6B7280", lineHeight: 1.8 }}>
          診断結果の読み解きから、診療メニュー別の改善優先順位、医院サイト・口コミ・予約導線の改善まで支援します。
        </p>
        <div className={`${styles.cardGrid} ${styles.cardGrid3}`} style={{ marginTop: 18 }}>
          {groups.map((group) => (
            <div key={group.title} className={styles.specialistCard}>
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

/* 13. 営業電話なし／セルフ完結 */
function NoSalesCallSection() {
  return (
    <section className={styles.sectionTight}>
      <div className={styles.card} style={{ textAlign: "center" }}>
        <p className={styles.eyebrow}>Sales Without Salespeople.</p>
        <h2 className={styles.heading} style={{ marginTop: 8, fontSize: 18 }}>
          プッシュ型営業は、一切いたしません。
        </h2>
        <p className={styles.sub} style={{ margin: "10px auto 0" }}>
          院長の時間を奪う営業電話は行いません。無料診断から利用開始まで、オンラインで完結します。ご希望の場合のみ、スペシャリストへの相談をご利用いただけます。
        </p>
      </div>
    </section>
  );
}

/* 導入フロー(参考情報として維持) */
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

/* 14. 比較: 3プランの機能比較表(唯一の情報源はplanCatalog、値の書き換えはしない) */
function PlanComparisonSection() {
  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>3プランの機能を比較する</h2>
      <p className={styles.sub}>詳しい条件は「プランの機能を詳しく比較する」ページでもご確認いただけます。</p>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>比較項目</th>
              <th>ライトプラン</th>
              <th className={styles.tableHighlightCol}>スタンダードプラン</th>
              <th>プレミアムプラン</th>
            </tr>
          </thead>
          <tbody>
            {PLAN_FEATURE_ROWS.map((row) => (
              <tr key={row.feature}>
                <td>{row.feature}</td>
                <td>{row.light}</td>
                <td className={styles.tableHighlightCol} style={{ fontWeight: 700 }}>
                  {row.standard}
                </td>
                <td>{row.premium}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className={styles.compareCards}>
          {PLAN_FEATURE_ROWS.map((row) => (
            <div key={row.feature} className={styles.compareCard}>
              <p style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 800, color: NAVY }}>{row.feature}</p>
              <div className={styles.compareRow}>
                <span style={{ color: "#6B7280" }}>ライトプラン</span>
                <span>{row.light}</span>
              </div>
              <div className={styles.compareRow}>
                <span style={{ color: BLUE, fontWeight: 700 }}>スタンダードプラン</span>
                <span style={{ fontWeight: 700, color: NAVY }}>{row.standard}</span>
              </div>
              <div className={styles.compareRow}>
                <span style={{ color: "#6B7280" }}>プレミアムプラン</span>
                <span>{row.premium}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* 15. FAQ: カテゴリ整理 + 初期表示5件強調 */
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
        { q: "電話番号は入力必須ですか？", a: "いいえ。医院名・院長名・医院URL・メールアドレスは必須ですが、電話番号は任意です。" },
        { q: "電話番号は何に使いますか？", a: "有料プランご契約時のなりすまし登録防止(SMS認証)にのみ使用します。営業電話のためにお電話することはありません。" },
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
      items: [{ q: "スペシャリストに相談できますか？", a: "診断結果の読み解きや改善優先順位について、オンラインで相談いただけます。" }],
    },
  ];

  const featuredQuestions = new Set([
    "本当に無料で診断できますか？",
    "電話番号は入力必須ですか？",
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

/* 16. 最終CTA */
function FinalCtaSection() {
  return (
    <section className={styles.sectionTight}>
      <div className={styles.finalCtaPanel}>
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
          <p style={{ color: "#9CA3AF", fontSize: 12, margin: "12px 0 0", lineHeight: 1.6 }}>{DIAGNOSIS_CTA_NOTE}</p>
        </div>
      </div>
    </section>
  );
}
