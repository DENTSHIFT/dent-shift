import Link from "next/link";
import type { DomainScore, OverallScoreStatus } from "@/domain/diagnosis/types";
import type { CompetitorClinic, PatientQuestionResult } from "@/domain/competitor/types";
import type { ImprovementCandidate } from "@/domain/improvement-task/types";
import { requireContact } from "@/server/auth/requireContact";
import { resolveBillingConfigFromProcessEnv } from "@/server/config/billingConfig";
import { getLatestSubscriptionByClinicId } from "@/server/db/billingRepository";
import { getDiagnosisById, getDiagnosesByClinicId } from "@/server/db/diagnosisRepository";
import { LogoutButton } from "./LogoutButton";
import { RegistrationProgressBanner } from "./RegistrationProgressBanner";
import { buildDashboardViewModel } from "./dashboardViewModel";
import { buildSubscriptionViewModel, type SubscriptionTone } from "./subscriptionViewModel";
import styles from "./dashboard.module.css";
import { SupportPhoneFooter } from "@/components/SupportPhoneFooter";
import { COMPETITOR_DISPLAY_LIMIT } from "@/domain/billing/planCatalog";
import {
  INSTRUCTION_PDF_ENTITLEMENT_KEY,
  INSTRUCTION_PDF_MONTHLY_QUOTA,
  currentEntitlementPeriod,
} from "@/domain/options/planEntitlements";
import { getEntitlementUsage } from "@/server/db/planEntitlementUsageRepository";

const NAV_ITEMS = [
  { label: "経営サマリー", icon: "⌂", href: "/dashboard", active: true },
  { label: "AI検索", icon: "✦", href: "#ai-search", active: false },
  { label: "競合医院", icon: "◎", href: "#competitors", active: false },
  { label: "改善アクション", icon: "✓", href: "#improvements", active: false },
  { label: "診断履歴", icon: "▤", href: "#history", active: false },
  { label: "契約状況", icon: "◇", href: "#subscription", active: false },
  { label: "初期設定", icon: "◫", href: "/onboarding", active: false },
  { label: "プラン比較", icon: "▦", href: "/plans", active: false },
] as const;

const DOMAIN_ICONS: Record<string, string> = {
  AIO: "✦",
  MEO: "⌖",
  SEO: "⌕",
  LLMO: "◎",
  WEB_BOOKING: "▣",
  REVIEWS: "◌",
};

function formatDate(value: Date | string) {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function trendClass(tone: "positive" | "negative" | "neutral") {
  if (tone === "positive") return `${styles.trend} ${styles.trendPositive}`;
  if (tone === "negative") return `${styles.trend} ${styles.trendNegative}`;
  return `${styles.trend} ${styles.trendNeutral}`;
}

function questionStatusClass(status: "win" | "close" | "lose" | "insufficient_data") {
  if (status === "win") return styles.statusGood;
  if (status === "close") return styles.statusClose;
  if (status === "lose") return styles.statusImprove;
  return styles.statusMissing;
}

function subscriptionStatusClass(tone: SubscriptionTone) {
  if (tone === "positive") return `${styles.subscriptionStatus} ${styles.subscriptionPositive}`;
  if (tone === "info") return `${styles.subscriptionStatus} ${styles.subscriptionInfo}`;
  if (tone === "warning") return `${styles.subscriptionStatus} ${styles.subscriptionWarning}`;
  if (tone === "danger") return `${styles.subscriptionStatus} ${styles.subscriptionDanger}`;
  return `${styles.subscriptionStatus} ${styles.subscriptionNeutral}`;
}

function DashboardNav({ bookingUrl }: { bookingUrl: string | undefined }) {
  return (
    <aside className={styles.sidebar}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className={styles.logo}
        src="/brand/logo/DENT_SHIFT_horizontal_tagline_transparent.png"
        alt="DENT SHIFT 歯科集患を、AIでシフトする。"
        width={1844}
        height={572}
      />
      <nav className={styles.nav} aria-label="ダッシュボードメニュー">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.label}
            href={item.href}
            className={`${styles.navLink} ${item.active ? styles.navActive : ""}`}
          >
            <span className={styles.navIcon} aria-hidden="true">
              {item.icon}
            </span>
            {item.label}
          </Link>
        ))}
        <span className={styles.navMuted}>
          <span className={styles.navIcon} aria-hidden="true">⚙</span>
          設定・連携（準備中）
        </span>
      </nav>

      <div className={styles.sideTrust}>
        <span className={styles.sideTrustIcon} aria-hidden="true">✓</span>
        <span>営業電話なし<br />オンライン完結</span>
      </div>

      {bookingUrl && (
        <section className={styles.sideConsult}>
          <span className={styles.sideConsultBadge}>無料・45分</span>
          <p className={styles.sideConsultTitle}>スペシャリストに相談する</p>
          <a className={styles.sideConsultLink} href={bookingUrl} target="_blank" rel="noreferrer">
            日程を選ぶ
          </a>
          <p className={styles.sideConsultNote}>相談は任意です。営業電話はありません。</p>
        </section>
      )}
    </aside>
  );
}

export default async function DashboardPage() {
  const contact = await requireContact({ next: "/dashboard" });
  const [diagnoses, subscription] = await Promise.all([
    getDiagnosesByClinicId(contact.clinicId),
    getLatestSubscriptionByClinicId(contact.clinicId),
  ]);
  const latest = diagnoses[0] ? await getDiagnosisById(diagnoses[0].id) : null;
  const history = diagnoses.map((diagnosis) => ({
    ...diagnosis,
    totalStatus: diagnosis.totalStatus as OverallScoreStatus,
  }));
  const latestForDisplay =
    latest && diagnoses[0]
      ? {
          id: diagnoses[0].id,
          diagnosis: {
            ...latest,
            totalStatus: latest.totalStatus as OverallScoreStatus,
            scoreBreakdown: latest.scoreBreakdown as {
              domains: DomainScore[];
              maxPoints: number;
              assessedMaxPoints: number;
              coverage: number;
            },
            competitors: latest.competitors as CompetitorClinic[],
            questionResults: latest.questionResults as PatientQuestionResult[],
            topImprovements: latest.topImprovements as ImprovementCandidate[],
          },
        }
      : null;
  const vm = buildDashboardViewModel(
    latestForDisplay,
    history
  );
  const bookingUrl = process.env.NEXT_PUBLIC_SPECIALIST_BOOKING_URL;
  let checkoutReady = false;
  try {
    checkoutReady = resolveBillingConfigFromProcessEnv().provider === "stripe";
  } catch {
    // 設定途中でも画面は表示し、契約準備中として扱う。
  }
  const subscriptionVm = buildSubscriptionViewModel(subscription, checkoutReady);

  // プラン別表示制御(2026-09-22のユーザー指示): 競合医院の表示件数(診断エンジン側の
  // 探索件数ではなく、既に取得済みの候補から画面へ出す件数のみを絞る)。未契約はlight相当。
  const competitorDisplayLimit = subscription
    ? COMPETITOR_DISPLAY_LIMIT[subscription.plan]
    : COMPETITOR_DISPLAY_LIMIT.light;

  // 指示書(制作会社向け修正指示書)の月次無料枠残数。ライトは元々0件(都度課金のみ)
  // のため表示しない。Stripeに0円商品を作らずPlanEntitlementUsageのみで判定する
  // 既存方針(Phase3)をそのまま画面へ出すだけで、新しいロジックは追加しない。
  let instructionPdfQuota: { remaining: number; total: number } | null = null;
  if (subscription) {
    const total = INSTRUCTION_PDF_MONTHLY_QUOTA[subscription.plan];
    if (total > 0) {
      const usage = await getEntitlementUsage({
        clinicId: contact.clinicId,
        entitlementKey: INSTRUCTION_PDF_ENTITLEMENT_KEY,
        period: currentEntitlementPeriod(),
      });
      instructionPdfQuota = { remaining: Math.max(0, total - (usage?.usedQuantity ?? 0)), total };
    }
  }

  return (
    <div className={styles.shell}>
      <DashboardNav bookingUrl={bookingUrl} />
      <div className={styles.main}>
        <header className={styles.topbar}>
          <div>
            <p className={styles.clinicEyebrow}>医院ダッシュボード</p>
            <p className={styles.clinicName}>{contact.clinic.name}</p>
          </div>
          <div className={styles.topActions}>
            <span className={styles.accountLabel}>{contact.email}</span>
            <LogoutButton />
          </div>
        </header>

        <main className={styles.content}>
          <div className={styles.pageHeading}>
            <div>
              <h1 className={styles.pageTitle}>経営サマリー</h1>
              <p className={styles.pageDescription}>現在のAI集患状況と、次に取り組む内容を確認できます。</p>
            </div>
            <Link className={styles.newDiagnosisLink} href="/diagnosis">
              新しく診断する
            </Link>
          </div>

          <RegistrationProgressBanner
            registrationStep={contact.registrationStep}
            hasActiveSubscription={subscription?.status === "active" || subscription?.status === "trial"}
          />

          <section className={styles.subscriptionCard} id="subscription" aria-label="契約状況">
            <div className={styles.subscriptionCopy}>
              <p className={styles.subscriptionEyebrow}>契約状況</p>
              <h2 className={styles.subscriptionPlan}>{subscriptionVm.planName}</h2>
              <p className={styles.subscriptionDescription}>{subscriptionVm.description}</p>
              {instructionPdfQuota && (
                <p className={styles.subscriptionDescription}>
                  制作会社向け修正指示書の無料枠: 今月あと{instructionPdfQuota.remaining}/
                  {instructionPdfQuota.total}件
                </p>
              )}
            </div>
            <div className={styles.subscriptionActions}>
              <span className={subscriptionStatusClass(subscriptionVm.tone)}>
                {subscriptionVm.statusLabel}
              </span>
              <Link className={styles.subscriptionLink} href={subscriptionVm.actionHref}>
                {subscriptionVm.actionLabel}
              </Link>
              {subscription &&
                checkoutReady &&
                !subscription.billingExempt &&
                !subscription.externalSubscriptionId?.startsWith("pilot_") && (
                  <form action="/api/billing/portal" method="post">
                    <button className={styles.subscriptionLinkButton} type="submit">
                      契約・請求を管理する
                    </button>
                  </form>
                )}
            </div>
          </section>

          {!vm.hasDiagnosis ? (
            <section className={styles.emptyCard}>
              <div className={styles.emptyIcon} aria-hidden="true">✦</div>
              <h2 className={styles.emptyTitle}>まずはAI集患診断を始めましょう</h2>
              <p className={styles.emptyText}>
                診断すると、6領域のスコアと患者質問ごとのAI表示状況、今月の優先改善がここに表示されます。
              </p>
              <Link className={styles.newDiagnosisLink} href="/diagnosis">
                無料でAI集患診断する
              </Link>
            </section>
          ) : (
            <>
              {vm.result.sampleBanner.show && (
                <div className={styles.sampleBanner}>
                  <strong>{vm.result.sampleBanner.title}：</strong>{vm.result.sampleBanner.subtitle}
                </div>
              )}

              {/* 2026-09-22最終修正: 最上段を4KPI(総合スコア/AI選出率/優先課題数/取得状況)に整理。
                  既存の算出値(overall.points/shareOfVoice/questionSummary/measurement)をそのまま
                  再利用するだけで、新しい集計ロジックは追加しない。 */}
              <section className={styles.metricsGrid} aria-label="サマリーKPI">
                <div className={styles.metricCard}>
                  <p className={styles.metricLabel}>総合スコア</p>
                  <p className={styles.metricValue}>{vm.result.overall.points} / {vm.result.overall.maxPoints}点</p>
                  <p className={styles.metricNote}>{vm.trend.label}</p>
                </div>
                <div className={styles.metricCard}>
                  <p className={styles.metricLabel}>AI選出率</p>
                  {vm.result.shareOfVoice.status === "measured" ? (
                    <>
                      <p className={styles.metricValue}>{vm.result.shareOfVoice.percentage}%</p>
                      <p className={styles.metricNote}>
                        患者質問{vm.result.shareOfVoice.measuredQuestionCount}件中
                        {vm.result.shareOfVoice.winCount}件で優位推薦
                      </p>
                    </>
                  ) : (
                    <>
                      <p className={styles.metricValue}>算出不可</p>
                      <p className={styles.metricNote}>0%として表示しません</p>
                    </>
                  )}
                </div>
                <div className={styles.metricCard}>
                  <p className={styles.metricLabel}>優先課題数</p>
                  <p className={styles.metricValue}>{vm.questionSummary.needsImprovement}件</p>
                  <p className={styles.metricNote}>競合優勢と判定された質問</p>
                </div>
                <div className={styles.metricCard}>
                  <p className={styles.metricLabel}>取得状況</p>
                  <p className={styles.metricValue} style={{ fontSize: 13 }}>
                    {vm.result.measurement.domainSourceSummary}
                  </p>
                  <p className={styles.metricNote}>未測定分は0点として扱いません</p>
                </div>
              </section>

              {/* 改善TOP3をフル幅で最上段直下に配置(2026-09-22最終修正) */}
              <article className={styles.card} id="improvements">
                <div className={styles.cardHeader}>
                  <div>
                    <h2 className={styles.sectionLabel}>今月の優先改善 TOP3</h2>
                    <p className={styles.cardSubtitle}>保存済みの診断結果に基づく優先順です。</p>
                  </div>
                  <Link className={styles.textLink} href={`/diagnosis/result/${vm.latestId}`}>詳細を見る</Link>
                </div>
                <div className={styles.improvementList}>
                  {vm.result.topImprovements.length === 0 ? (
                    <p className={styles.itemDescription}>現在表示できる改善項目はありません。</p>
                  ) : (
                    vm.result.topImprovements.slice(0, 3).map((task, index) => (
                      <div className={styles.improvementItem} key={task.key}>
                        <span className={styles.rank}>{index + 1}</span>
                        <div>
                          <p className={styles.itemTitle}>{task.title}</p>
                          <p className={styles.itemDescription}>理由：{task.detectedFact}</p>
                          <p className={styles.itemDescription}>まずやること：{task.firstAction}</p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </article>

              <section className={styles.overviewGrid} aria-label="診断スコア概要">
                <div className={`${styles.card} ${styles.scoreCard}`}>
                  <h2 className={styles.sectionLabel}>AI集患総合スコア</h2>
                  <div
                    className={styles.gauge}
                    style={{
                      background: `conic-gradient(#2563EB ${Math.max(
                        0,
                        Math.min(100, vm.result.overall.points)
                      )}%, #E5E9F0 0)`,
                    }}
                  >
                    <div className={styles.gaugeInner}>
                      <span className={styles.scoreNumber}>{vm.result.overall.points}</span>
                      <span className={styles.scoreMax}>/ {vm.result.overall.maxPoints}点</span>
                    </div>
                  </div>
                  <span className={trendClass(vm.trend.tone)}>{vm.trend.label}</span>
                  {vm.result.overall.statusCaveat && (
                    <p className={styles.scoreCaveat}>{vm.result.overall.statusCaveat}</p>
                  )}
                </div>

                <div className={styles.card}>
                  <h2 className={styles.sectionLabel}>6領域スコア</h2>
                  <div className={styles.domainsGrid}>
                    {vm.result.domains.map((domain) => (
                      <div className={styles.domainCard} key={domain.domain}>
                        <div className={styles.domainHeader}>
                          <span className={styles.domainIdentity}>
                            <span className={styles.domainIcon} aria-hidden="true">
                              {DOMAIN_ICONS[domain.domain] ?? "✦"}
                            </span>
                            <span>{domain.label}</span>
                          </span>
                          {domain.showEstimatedBadge && <span className={styles.badge}>推定</span>}
                        </div>
                        <p className={styles.domainPoints}>{domain.pointsLabel}</p>
                        {domain.percent !== null && (
                          <div className={styles.bar} aria-hidden="true">
                            <div className={styles.barFill} style={{ width: `${domain.percent}%` }} />
                          </div>
                        )}
                        {(domain.unavailableReasonLabel || domain.partialNote) && (
                          <p className={styles.domainNote}>{domain.unavailableReasonLabel ?? domain.partialNote}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              <section className={styles.twoColumn} id="ai-search">
                <div className={styles.stack}>
                  <article className={styles.card}>
                    <div className={styles.cardHeader}>
                      <div>
                        <h2 className={styles.sectionLabel}>患者質問ごとのAI表示状況</h2>
                        <p className={styles.cardSubtitle}>中立的な表現で、現在の状態を示します。</p>
                      </div>
                    </div>
                    <div className={styles.questionList}>
                      {vm.result.questionResults.slice(0, 6).map((question) => (
                        <div className={styles.questionItem} key={question.question}>
                          <p className={styles.questionText}>{question.question}</p>
                          <span className={questionStatusClass(question.status)}>{question.statusLabel}</span>
                        </div>
                      ))}
                    </div>
                  </article>

                  <article className={styles.card}>
                    <div className={styles.cardHeader}>
                      <div>
                        <h2 className={styles.sectionLabel}>AIから予約まで</h2>
                        <p className={styles.cardSubtitle}>不足データを0件として表示しません。</p>
                      </div>
                      <span className={styles.dataBadge}>データ未連携</span>
                    </div>
                    <div className={styles.integrationFlow}>
                      {["AI経由サイト流入", "診療ページ閲覧", "予約フォーム開始", "予約完了", "新患"].map((label) => (
                        <div className={styles.flowRow} key={label}>
                          <span>{label}</span>
                          <span className={styles.flowState}>連携後に表示</span>
                        </div>
                      ))}
                    </div>
                  </article>
                </div>

                <div className={styles.stack}>
                  <article className={styles.card} id="competitors">
                    <div className={styles.cardHeader}>
                      <div>
                        <h2 className={styles.sectionLabel}>競合医院候補</h2>
                        <p className={styles.cardSubtitle}>競合スコアは未取得のため表示していません。</p>
                      </div>
                    </div>
                    <div className={styles.competitorList}>
                      {vm.result.competitors.length === 0 ? (
                        <p className={styles.itemDescription}>競合候補のデータがありません。</p>
                      ) : (
                        vm.result.competitors.slice(0, competitorDisplayLimit).map((competitor) => (
                          <div className={styles.competitorItem} key={`${competitor.name}-${competitor.url ?? ""}`}>
                            <p className={styles.competitorName}>{competitor.name}</p>
                            <span className={styles.competitorMeta}>{competitor.distanceLabel ?? "候補"}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </article>

                  <article className={styles.card} id="history">
                    <div className={styles.cardHeader}>
                      <div>
                        <h2 className={styles.sectionLabel}>診断履歴</h2>
                        <p className={styles.cardSubtitle}>過去の結果を確認できます。</p>
                      </div>
                    </div>
                    <div className={styles.historyList}>
                      {vm.history.slice(0, 5).map((diagnosis) => (
                        <Link className={styles.historyItem} key={diagnosis.id} href={`/diagnosis/result/${diagnosis.id}`}>
                          <p className={styles.historyDate}>{formatDate(diagnosis.measuredAt)}</p>
                          <span className={styles.historyScore}>
                            {diagnosis.totalStatus === "unavailable"
                              ? "取得不能"
                              : `${diagnosis.totalPoints} / 100点${diagnosis.isSample ? "（参考）" : ""}`}
                          </span>
                        </Link>
                      ))}
                    </div>
                  </article>

                  {bookingUrl && (
                    <article className={`${styles.card} ${styles.mobileConsultCard}`}>
                      <span className={styles.sideConsultBadge}>無料・45分</span>
                      <h2 className={styles.sectionLabel}>スペシャリストに相談する</h2>
                      <p className={styles.itemDescription}>診断結果や改善の進め方を相談できます。予約は任意です。</p>
                      <a className={styles.newDiagnosisLink} href={bookingUrl} target="_blank" rel="noreferrer">日程を選ぶ</a>
                    </article>
                  )}
                </div>
              </section>
            </>
          )}
          <SupportPhoneFooter />
        </main>
      </div>

      <nav className={styles.mobileNav} aria-label="モバイルメニュー">
        <Link href="/dashboard"><span aria-hidden="true">⌂</span>サマリー</Link>
        <Link href="#ai-search"><span aria-hidden="true">✦</span>AI検索</Link>
        <Link href="#improvements"><span aria-hidden="true">✓</span>改善</Link>
        <Link href="#history"><span aria-hidden="true">▤</span>履歴</Link>
        <Link href="#subscription"><span aria-hidden="true">◇</span>契約</Link>
      </nav>
    </div>
  );
}
