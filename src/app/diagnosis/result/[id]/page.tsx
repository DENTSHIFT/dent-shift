import { notFound } from "next/navigation";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { getDiagnosisById } from "@/server/db/diagnosisRepository";
import { getSelfServeMarksForReport } from "@/server/db/improvementActionSelfServeRepository";
import { getCurrentContact } from "@/server/auth/session";
import type { DomainScore, OverallScoreStatus } from "@/domain/diagnosis/types";
import type { CompetitorClinic, PatientQuestionResult } from "@/domain/competitor/types";
import type { ImprovementCandidate } from "@/domain/improvement-task/types";
import type { AdComplianceCheckResult } from "@/domain/ad-compliance/types";
import {
  buildFreeDiagnosisResultViewModel,
  type AdComplianceFindingViewModel,
  type DomainViewModel,
  type ImprovementViewModel,
  type LossRootCauseViewModel,
  type QuestionResultViewModel,
} from "./resultViewModel";
import type { ShareOfVoiceResult } from "@/domain/competitor/shareOfVoice";
import { shouldShowDashboardReturnLink } from "./resultNavigation";
import { isDiagnosisResultAccessible } from "./resultAccess";
import { formatMeasuredAtInJapan } from "@/domain/diagnosis/formatMeasuredAt";
import { buildResultEmailDeliveryNotice } from "@/domain/email/resultEmailDeliveryStatus";
import { TrackedCtaLink } from "./TrackedCtaLink";
import { InstructionPdfOrderButton } from "./InstructionPdfOrderButton";
import { SelfServeToggleButton } from "./SelfServeToggleButton";

// DENT SHIFT正式カラー(public/brand/logo/README_使用ガイド.md「正式カラー」節が正本)。
// Claudeが独自に配色を作らず、ここでもこのブランドガイドの値のみを使用する。
const NAVY = "#0F1B2D";
const BLUE = "#2563EB";
const BG = "#F5F7FA";
const BORDER = "#E5E9F0";
const MUTED = "#6B7280";

// 2026-09-22最終修正: 総合スコアだけでは良否が伝わらないため、点数帯ごとの評価ラベルを付す。
function scoreEvaluationLabel(points: number): { label: string; color: string } {
  if (points >= 85) return { label: "優良", color: "#166534" };
  if (points >= 70) return { label: "良好", color: "#166534" };
  if (points >= 40) return { label: "改善余地あり", color: "#B45309" };
  return { label: "要改善", color: "#B91C1C" };
}

const STATUS_COLOR: Record<PatientQuestionResult["status"], string> = {
  win: "#16A34A",
  close: "#D97706",
  lose: "#DC2626",
  insufficient_data: "#6B7280",
};

export default async function DiagnosisResultPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [diagnosis, currentContact] = await Promise.all([
    getDiagnosisById(id),
    getCurrentContact(),
  ]);
  if (!diagnosis) notFound();
  // 会員登録済み医院の診断結果は「契約後データ」として所有者以外に見せない
  // (2026-09-21のユーザー指示)。未登録医院の診断は従来どおり匿名閲覧可能。
  // 存在有無を漏らさないため、通常の未検出と同じnotFound()で返す。
  if (
    !isDiagnosisResultAccessible({
      clinicHasAccount: diagnosis.clinicHasAccount,
      contactClinicId: currentContact?.clinicId,
      diagnosisClinicId: diagnosis.clinicId,
    })
  ) {
    notFound();
  }
  const showDashboardReturn = shouldShowDashboardReturnLink(
    currentContact?.clinicId,
    diagnosis.clinicId
  );
  // ①自院で対応マークは所有者にのみ意味を持つため、所有者以外では問い合わせない。
  const selfServeMarks = showDashboardReturn
    ? await getSelfServeMarksForReport({ reportId: id, version: 1 })
    : new Map<string, Date>();

  const vm = buildFreeDiagnosisResultViewModel({
    clinicId: diagnosis.clinicId,
    clinicName: diagnosis.clinicName,
    clinicUrl: diagnosis.clinicUrl,
    totalPoints: diagnosis.totalPoints,
    // Prisma schemaではtotalStatusは検証用の生String列(prisma/schema.prisma参照)。
    // 値の生成元(scoring.ts)はOverallScoreStatusの4値のみを書き込むため、表示直前の
    // ここでのみ型を確定させる(算出ロジック・永続化スキーマは変更しない)。
    totalStatus: diagnosis.totalStatus as OverallScoreStatus,
    scoreBreakdown: diagnosis.scoreBreakdown as {
      domains: DomainScore[];
      maxPoints: number;
      assessedMaxPoints: number;
      coverage: number;
    },
    competitors: diagnosis.competitors as CompetitorClinic[],
    questionResults: diagnosis.questionResults as PatientQuestionResult[],
    topImprovements: diagnosis.topImprovements as ImprovementCandidate[],
    adComplianceChecks: diagnosis.adComplianceChecks as AdComplianceCheckResult,
    isSample: diagnosis.isSample,
    dataDisclaimer: diagnosis.dataDisclaimer,
    measuredAt: diagnosis.measuredAt,
  });

  const measuredAtLabel = formatMeasuredAtInJapan(vm.measurement.measuredAtIso);
  const resultEmailNotice = buildResultEmailDeliveryNotice(diagnosis.resultEmailStatus);
  const hasLoseQuestions = vm.questionResults.some((q) => q.status === "lose");
  const gaugePercent = Math.max(
    0,
    Math.min(100, (vm.overall.points / (vm.overall.maxPoints || 100)) * 100)
  );

  return (
    <main style={{ background: BG, minHeight: "100vh", paddingBottom: 64 }}>
      {/* 2026-09-06のユーザー指示(最終UX調整): 院長が画面を開いて3秒以内に
          「今どれくらいの状態か/どこで負けているか/今月何をすべきか」を理解できるよう、
          ファーストビューの情報階層を「医院名→総合スコア→6領域→改善TOP3」の順に固定する。
          PC(2カラム)ではdivを分けたまま従来どおり配置できるが、モバイル(1カラム)では
          DOM順のまま積むと「改善TOP3」がサイドバー要素としてページ末尾近くまで
          遅れてしまう。これを避けるため、.ds-result-main/.ds-result-sidebarを
          モバイルでは`display:contents`にして中の各Cardをグリッドの直接の子として扱い、
          `order`で「医院名→総合スコア→6領域→改善TOP3→患者質問→なぜ負けている→
          競合→医療広告AIチェック→診断ステータス」の順に並べ替える
          (PC(min-width:960px)ではdisplay:gridに戻し、既存の2カラム+sticky構成を維持)。 */}
      <style>{`
        .ds-result-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 16px;
          margin-top: 16px;
        }
        .ds-result-main,
        .ds-result-sidebar {
          display: contents;
        }
        .ds-order-clinic { order: 1; }
        .ds-order-score { order: 2; }
        .ds-order-summary { order: 3; }
        .ds-order-top3 { order: 4; }
        .ds-order-domains { order: 5; }
        .ds-order-questions { order: 6; }
        .ds-order-rootcause { order: 7; }
        .ds-order-competitors { order: 8; }
        .ds-order-adcompliance { order: 9; }
        .ds-order-status { order: 10; }
        .ds-order-consultation { order: 11; }
        @media (min-width: 960px) {
          .ds-result-grid {
            grid-template-columns: minmax(0, 2.2fr) minmax(300px, 1fr);
            gap: 20px;
          }
          .ds-result-main,
          .ds-result-sidebar {
            display: grid;
            gap: 16px;
            align-content: start;
          }
          .ds-result-sidebar {
            position: sticky;
            top: 24px;
          }
        }
        .ds-details summary {
          cursor: pointer;
          list-style: none;
          font-size: 12px;
          color: ${BLUE};
          font-weight: 600;
        }
        .ds-details summary::-webkit-details-marker {
          display: none;
        }
        .ds-details summary:focus-visible {
          outline: 2px solid ${BLUE};
          outline-offset: 2px;
        }
        @media (max-width: 599px) {
          .ds-score-gauge {
            width: 144px !important;
            height: 144px !important;
          }
        }
      `}</style>

      <header
        style={{
          background: "#fff",
          borderBottom: `1px solid ${BORDER}`,
        }}
      >
        <div
          style={{
            maxWidth: 1280,
            minHeight: 72,
            margin: "0 auto",
            padding: "0 24px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          {/* ロゴは正本(public/brand/logo)をそのまま使用。変形・再配色はしない
              (DESIGN_SYSTEM.md「ロゴ」節の禁止事項)。 */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/logo/DENT_SHIFT_horizontal_tagline_transparent.png"
            alt="DENT SHIFT 歯科集患を、AIでシフトする。"
            width={1844}
            height={572}
            style={{ width: 172, height: "auto", display: "block" }}
          />
          {showDashboardReturn && (
            <Link
              href="/dashboard"
              style={{
                display: "inline-flex",
                alignItems: "center",
                minHeight: 40,
                padding: "8px 16px",
                border: `1px solid ${BORDER}`,
                borderRadius: 10,
                background: "#fff",
                color: NAVY,
                fontSize: 13,
                fontWeight: 700,
                textDecoration: "none",
              }}
            >
              ダッシュボードに戻る
            </Link>
          )}
        </div>
      </header>

      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "24px 24px 0" }}>

        <div style={{ display: "grid", gap: 8 }}>
          {vm.sampleBanner.show && (
            <Banner tone="sample" title={vm.sampleBanner.title} text={vm.sampleBanner.subtitle} />
          )}
          <Banner
            tone={resultEmailNotice.tone}
            title={resultEmailNotice.title}
            text={resultEmailNotice.text}
          />
        </div>

        <div className="ds-result-grid">
          {/* 左カラム(メイン, 約70-75%): 総合診断/6領域/患者質問/なぜ負けている/競合比較/
              医療広告AIチェック。各Cardのds-order-*クラスはモバイル表示順の制御専用
              (デスクトップでは無効、DOM順=既存の見た目のまま)。 */}
          <div className="ds-result-main">
            {/* 総合診断(1/2): 医院名・計測日時 */}
            <Card className="ds-order-clinic">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
                <div>
                  <p style={{ margin: 0, fontSize: 13, color: MUTED }}>無料AI集患診断 結果</p>
                  <h1 style={{ margin: "4px 0 0", fontSize: 22, color: NAVY, fontWeight: 700 }}>
                    {vm.clinicName}
                  </h1>
                  <p style={{ margin: "6px 0 0", fontSize: 12, color: MUTED }}>
                    計測日時: {measuredAtLabel}
                  </p>
                  <p style={{ margin: "2px 0 0", fontSize: 12, color: MUTED }}>{vm.clinicUrl}</p>
                </div>
              </div>
            </Card>

            {/* 総合診断(2/2): AI集患総合スコア(このページで唯一のスコア表示) */}
            <Card className="ds-order-score">
              <SectionTitle title="AI集患総合スコア" />
              <div style={{ display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap" }}>
                <div
                  className="ds-score-gauge"
                  style={{
                    position: "relative",
                    width: 168,
                    height: 168,
                    borderRadius: "50%",
                    background: `conic-gradient(${BLUE} ${gaugePercent}%, ${BORDER} 0)`,
                    flexShrink: 0,
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      inset: 10,
                      borderRadius: "50%",
                      background: "#fff",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <span style={{ fontSize: 44, fontWeight: 800, color: NAVY, lineHeight: 1 }}>
                      {vm.overall.points}
                    </span>
                    <span style={{ fontSize: 12, color: MUTED }}>/ {vm.overall.maxPoints}点</span>
                    {!vm.overall.statusCaveat && (
                      <span
                        style={{
                          marginTop: 4,
                          fontSize: 11,
                          fontWeight: 700,
                          color: scoreEvaluationLabel(vm.overall.points).color,
                        }}
                      >
                        {scoreEvaluationLabel(vm.overall.points).label}
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ flex: 1, minWidth: 200 }}>
                  {vm.overall.statusCaveat ? (
                    <Tag tone="warn">{vm.overall.statusCaveat}</Tag>
                  ) : (
                    <p style={{ margin: 0, fontSize: 13, color: MUTED }}>
                      6領域(AIO・MEO・SEO・LLMO・Web予約・口コミ)の合計スコアです。
                    </p>
                  )}
                  <p style={{ marginTop: 10, fontSize: 12, color: MUTED }}>
                    データソース: {vm.measurement.domainSourceSummary}
                  </p>
                  <ShareOfVoiceStat shareOfVoice={vm.shareOfVoice} />
                </div>
              </div>
            </Card>

            {/* 診断要約(2026-09-22最終修正): 総合スコア直後に1文で「今どういう状態か」を示す。
                新しい判定ロジックは追加せず、既存のvm(評価ラベル・改善TOP3の1位)のみから組み立てる。 */}
            {vm.topImprovements.length > 0 && (
              <Card className="ds-order-summary">
                <p style={{ margin: 0, fontSize: 13, color: NAVY, lineHeight: 1.8 }}>
                  {vm.overall.statusCaveat
                    ? vm.overall.statusCaveat
                    : `AI集患スコアは「${scoreEvaluationLabel(vm.overall.points).label}」です。`}
                  {" "}
                  特に「{vm.topImprovements[0]!.title}」の改善が優先です。
                </p>
              </Card>
            )}

            {/* 6領域スコア */}
            <Card className="ds-order-domains">
              <SectionTitle title="6領域スコア" subtitle="AIO / MEO / SEO / LLMO / Web予約 / 口コミ・信頼" />
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                  gap: 12,
                }}
              >
                {vm.domains.map((d) => (
                  <DomainCard key={d.domain} domain={d} />
                ))}
              </div>
            </Card>

            {/* 患者質問ごとのAI表示状況(2026-09-06のユーザー指示③: 初期表示は質問+ステータスのみ、
                根拠(evidence)は「詳細を見る」で展開。status・根拠データ自体は削除しない) */}
            <Card className="ds-order-questions">
              <SectionTitle title="患者質問ごとのAI表示状況" subtitle="AIに患者質問を投げ、自院が推薦されたかを確認しています" />
              <div style={{ display: "grid", gap: 10 }}>
                {vm.questionResults.map((q) => (
                  <QuestionRow key={q.question} q={q} />
                ))}
              </div>
            </Card>

            {/* 「改善余地がある理由」root cause TOP3(=原因説明。改善TOP3とは別セクション)。
                2026-09-06のユーザー指示④: 初期表示は原因タイトル/影響質問数/確度/
                参考データか実測かのみとし、対象質問・競合との差・evidenceは詳細展開にする。 */}
            <Card className="ds-order-rootcause">
              <SectionTitle
                title="改善余地がある理由"
                subtitle="「競合優勢」と判定された質問について、根拠のある範囲でのみ原因を示します(原因説明)"
              />
              {vm.lossRootCauses.length > 0 ? (
                <div style={{ display: "grid", gap: 14 }}>
                  {vm.lossRootCauses.map((rc) => (
                    <LossRootCauseCard key={rc.rootCauseKey} rc={rc} />
                  ))}
                </div>
              ) : hasLoseQuestions ? (
                <EmptyNote text="改善余地のある質問はありますが、根拠不足のため原因を特定できませんでした(捏造を避けるため、断定的な原因表示はしていません)。" />
              ) : (
                <EmptyNote text="現時点で「競合優勢」と判定された患者質問はありません。" tone="positive" />
              )}
            </Card>

            {/* 競合比較 */}
            <Card className="ds-order-competitors">
              <SectionTitle title="近隣の競合医院" subtitle="近隣競合との比較機能は準備中です" />
              {vm.competitors.length > 0 ? (
                <div style={{ display: "grid", gap: 8 }}>
                  {vm.competitors.map((c, i) => (
                    <div
                      key={`${c.name}-${i}`}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        border: `1px solid ${BORDER}`,
                        borderRadius: 10,
                        padding: "10px 14px",
                      }}
                    >
                      <span style={{ fontSize: 14, color: NAVY }}>
                        {c.url ? (
                          <a href={c.url} target="_blank" rel="noreferrer" style={{ color: NAVY }}>
                            {c.name}
                          </a>
                        ) : (
                          c.name
                        )}
                      </span>
                      {c.distanceLabel && (
                        <span style={{ fontSize: 12, color: MUTED }}>{c.distanceLabel}</span>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyNote text="近隣競合比較は現在準備中です。対応が完了次第、この結果ページに反映されます。" />
              )}
            </Card>

            {/* 医療広告AIチェック(2026-09-22最終修正): 長文カードの羅列から、
                「検出N件・重要度高N件」の件数サマリー+個別所見はアコーディオンへ変更。
                既存のfindingデータ・判定ロジックは変更せず、表示形式のみ変更する。 */}
            <Card className="ds-order-adcompliance">
              <SectionTitle title="医療広告AIチェック" />
              {vm.adCompliance.findings.length > 0 ? (
                <>
                  <Banner tone="info" text={vm.adCompliance.disclaimer} />
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                    <Tag tone="muted">検出 {vm.adCompliance.findings.length}件</Tag>
                    {vm.adCompliance.findings.filter((f) => f.severityLabel.includes("高")).length > 0 && (
                      <Tag tone="warn">
                        高リスク {vm.adCompliance.findings.filter((f) => f.severityLabel.includes("高")).length}件
                      </Tag>
                    )}
                  </div>
                  <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
                    {vm.adCompliance.findings.map((f) => (
                      <AdComplianceFindingCard key={f.id} f={f} />
                    ))}
                  </div>
                </>
              ) : (
                <EmptyNote text="医療広告AIチェックは現在準備中です。対応が完了次第、この結果ページに反映されます。" />
              )}
            </Card>
          </div>

          {/* 右カラム(サイド, 約25-30%, PCではsticky)。2026-09-06のユーザー指示⑥:
              「今月やるべきことTOP3→診断ステータス→将来:無料相談CTA」の順を基本にする。 */}
          <div className="ds-result-sidebar">
            <Card className="ds-order-top3">
              <SectionTitle
                title="今月やるべきこと(改善TOP3)"
                subtitle="優先度の高い改善アクションです(行動優先順位)"
              />
              <div style={{ display: "grid", gap: 12 }}>
                {vm.topImprovements.map((task, i) => (
                  <ImprovementCard
                    key={task.key}
                    rank={i + 1}
                    task={task}
                    reportId={id}
                    isOwner={showDashboardReturn}
                    selfServeMarkedAt={selfServeMarks.get(task.key) ?? null}
                  />
                ))}
                {vm.topImprovements.length === 0 && (
                  <EmptyNote text="現時点で表示できる改善アクションはありません。" tone="positive" />
                )}
              </div>
            </Card>

            <Card className="ds-order-status">
              <SectionTitle title="診断ステータス" />
              <p style={{ fontSize: 12, color: "#374151", margin: 0 }}>{vm.measurement.summaryLabel}</p>
              <p style={{ fontSize: 11, color: MUTED, marginTop: 8 }}>
                計測日: {measuredAtLabel} ／ データの取得状況: {vm.measurement.domainSourceSummary}
              </p>
              <details className="ds-details" style={{ marginTop: 8 }}>
                <summary>詳細を見る(技術的な注記)</summary>
                <p style={{ fontSize: 11, color: MUTED, margin: "8px 0 0" }}>
                  {vm.measurement.technicalDisclaimer}
                </p>
              </details>
            </Card>

            <ConsultationCta diagnosisId={id} className="ds-order-consultation" compact />
          </div>
        </div>

        <section
          style={{
            marginTop: 20,
            padding: "22px 24px",
            background: "#fff",
            border: `1px solid ${BORDER}`,
            borderRadius: 16,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 16,
          }}
        >
          <div>
            <h2 style={{ margin: 0, color: NAVY, fontSize: 17 }}>継続的な改善を始める</h2>
            <p style={{ margin: "6px 0 0", color: MUTED, fontSize: 12 }}>
              3つのプランの機能差を確認できます。料金確定前に請求が始まることはありません。
            </p>
          </div>
          <Link
            href="/plans"
            style={{
              display: "inline-flex",
              minHeight: 42,
              alignItems: "center",
              padding: "8px 18px",
              borderRadius: 10,
              background: BLUE,
              color: "#fff",
              fontSize: 13,
              fontWeight: 700,
              textDecoration: "none",
            }}
          >
            改善プランを比較する
          </Link>
        </section>

        <PhoneInquiryCta diagnosisId={id} />

        <p style={{ fontSize: 12, color: "#9CA3AF", marginTop: 24, textAlign: "center" }}>
          本レポートはAIによる参考情報です。医療広告・法的判断についての最終判断は医院または専門家が行ってください。
        </p>
      </div>
    </main>
  );
}

function Card({
  children,
  style,
  className,
}: {
  children: ReactNode;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <section
      className={className}
      style={{
        background: "#fff",
        border: `1px solid ${BORDER}`,
        borderRadius: 16,
        padding: 22,
        // 2026-09-06のユーザー指示(最終UX調整): モバイルでの「display:contents+order」
        // 並べ替えと二重の余白にならないよう、Card自体はmarginを持たず、間隔は
        // 親グリッド(.ds-result-grid / .ds-result-main / .ds-result-sidebar)のgapに
        // 統一する。グリッド外で使う場合はstyleで個別に指定する。
        margin: 0,
        boxShadow: "0 1px 2px rgba(15,27,45,0.04)",
        ...style,
      }}
    >
      {children}
    </section>
  );
}

function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <h2 style={{ margin: 0, fontSize: 16, color: NAVY, fontWeight: 700 }}>{title}</h2>
      {subtitle && <p style={{ margin: "4px 0 0", fontSize: 12, color: MUTED }}>{subtitle}</p>}
    </div>
  );
}

function Tag({ children, tone }: { children: ReactNode; tone: "warn" | "info" | "muted" | "danger" }) {
  const colors = {
    warn: { bg: "#FEF3C7", fg: "#92400E" },
    info: { bg: "#EFF6FF", fg: "#1E3A8A" },
    muted: { bg: "#F1F5F9", fg: MUTED },
    danger: { bg: "#FEF2F2", fg: "#991B1B" },
  }[tone];
  return (
    <span
      style={{
        display: "inline-block",
        background: colors.bg,
        color: colors.fg,
        fontSize: 12,
        padding: "4px 10px",
        borderRadius: 999,
      }}
    >
      {children}
    </span>
  );
}

/**
 * AI推薦シェア(Share of Voice)。患者質問のうちAIに優位推薦されている割合。
 * 測定対象質問が1件もない(insufficient_data)場合は0%と表示せず、
 * 「算出できませんでした」と明示する(取得不能値を0として扱わない方針)。
 */
function ShareOfVoiceStat({ shareOfVoice }: { shareOfVoice: ShareOfVoiceResult }) {
  if (shareOfVoice.status === "insufficient_data") {
    return (
      <p style={{ marginTop: 6, fontSize: 12, color: MUTED }}>
        AI推薦シェア: 算出できませんでした(測定対象の質問がありません)
      </p>
    );
  }
  return (
    <p style={{ marginTop: 6, fontSize: 12, color: MUTED }}>
      AI推薦シェア: <strong style={{ color: NAVY }}>{shareOfVoice.percentage}%</strong>
      (患者質問{shareOfVoice.measuredQuestionCount}件中{shareOfVoice.winCount}件で優位推薦)
    </p>
  );
}

/**
 * 2026-09-06のユーザー指示⑦: 「サンプル診断」であることは明確に維持しつつ、
 * ページ全体が警告画面のように見えないようパディング・文字サイズを少し抑える
 * (文言自体の意味はbuildSampleBanner側で維持。ここは見た目の圧縮のみ)。
 */
function Banner({
  tone,
  title,
  text,
}: {
  tone: "sample" | "info" | "success" | "error";
  title?: string;
  text: string;
}) {
  const styles = {
    sample: { background: "#FEF3C7", border: "1px solid #F59E0B", color: "#92400E" },
    info: { background: "#EFF6FF", border: "1px solid #BFDBFE", color: "#1E3A8A" },
    success: { background: "#F0FDF4", border: "1px solid #BBF7D0", color: "#166534" },
    error: { background: "#FEF2F2", border: "1px solid #FECACA", color: "#991B1B" },
  } as const;
  const style = styles[tone];
  return (
    <div style={{ ...style, borderRadius: 10, padding: "10px 14px", fontSize: 12 }}>
      {title && <p style={{ margin: "0 0 2px", fontWeight: 700 }}>{title}</p>}
      <p style={{ margin: 0 }}>{text}</p>
    </div>
  );
}

function EmptyNote({ text, tone }: { text: string; tone?: "positive" }) {
  return (
    <p
      style={{
        margin: 0,
        fontSize: 13,
        color: tone === "positive" ? "#166534" : MUTED,
        background: tone === "positive" ? "#F0FDF4" : "#F9FAFB",
        border: `1px solid ${tone === "positive" ? "#BBF7D0" : BORDER}`,
        borderRadius: 10,
        padding: "12px 14px",
      }}
    >
      {text}
    </p>
  );
}

function DomainCard({ domain }: { domain: DomainViewModel }) {
  const isUnavailable = domain.status === "unavailable";
  const percent = domain.percent ?? 0;

  return (
    <div
      style={{
        border: `1px solid ${BORDER}`,
        borderRadius: 12,
        padding: 14,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 13, color: NAVY, fontWeight: 600 }}>{domain.label}</span>
        {/* 「推定」は文字色だけでなく、他の所見(医療広告AIチェック等)と同じTagコンポーネントで
            統一したバッジ表示にする(2026-09-06の既存ユーザー指示、変更なし)。 */}
        {domain.showEstimatedBadge && <Tag tone="warn">推定</Tag>}
      </div>
      <p
        style={{
          margin: "8px 0 6px",
          fontSize: isUnavailable ? 14 : 22,
          fontWeight: 700,
          color: isUnavailable ? "#9CA3AF" : NAVY,
        }}
      >
        {domain.pointsLabel}
      </p>
      {!isUnavailable && (
        <div style={{ height: 6, borderRadius: 999, background: BORDER, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${percent}%`, background: BLUE }} />
        </div>
      )}
      {domain.unavailableReasonLabel && (
        <p style={{ margin: "4px 0 0", fontSize: 11, color: "#9CA3AF" }}>
          {domain.unavailableReasonLabel}
        </p>
      )}
      {domain.partialNote && (
        <p style={{ margin: "6px 0 0", fontSize: 11, color: "#D97706" }}>{domain.partialNote}</p>
      )}
    </div>
  );
}

/**
 * 患者質問ごとのAI表示状況(2026-09-06のユーザー指示③)。初期表示は質問文+ステータスバッジ
 * (+補足の一言があれば1行)のみ。根拠(evidence、AIの回答由来の引用)は情報量が多いため
 * 「詳細を見る」で展開する。evidence自体はresultViewModel.tsで角括弧タグ([chatgpt]等)を
 * 除去済みの構造化データ(EvidenceViewModel)を受け取るだけで、ここでは削除しない。
 */
function QuestionRow({ q }: { q: QuestionResultViewModel }) {
  return (
    <div
      style={{
        border: `1px solid ${BORDER}`,
        borderRadius: 10,
        padding: 14,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 14, color: NAVY }}>{q.question}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <Tag tone={q.dataSourceTone}>{q.dataSourceLabel}</Tag>
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: "#fff",
              background: STATUS_COLOR[q.status],
              padding: "3px 10px",
              borderRadius: 999,
              height: "fit-content",
            }}
          >
            {q.statusLabel}
          </span>
        </div>
      </div>
      {q.captionLabel && (
        <p style={{ margin: "6px 0 0", fontSize: 12, color: MUTED }}>{q.captionLabel}</p>
      )}
      {q.evidence.length > 0 && (
        <details className="ds-details" style={{ marginTop: 8 }}>
          <summary>詳細を見る(根拠)</summary>
          <ul style={{ margin: "8px 0 0", paddingLeft: 18, color: MUTED, fontSize: 12 }}>
            {q.evidence.map((e, i) => (
              <li key={i}>
                {e.text}
                {e.providerLabel && (
                  <span style={{ color: "#9CA3AF" }}>
                    {" "}
                    ー {e.providerLabel}
                    {e.isSample ? "・参考データ" : ""}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/**
 * 「改善余地がある理由」(2026-09-06のユーザー指示④)。初期表示は
 * 原因タイトル/影響している患者質問数/確度/参考データか実測か、の4点のみ。
 * 対象患者質問・競合との差・evidenceは「詳細を見る」で展開する。
 */
function LossRootCauseCard({ rc }: { rc: LossRootCauseViewModel }) {
  return (
    <div style={{ border: `1px solid ${BORDER}`, borderRadius: 10, padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: NAVY }}>{rc.rootCauseLabel}</p>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <Tag tone="muted">{rc.confidenceLabel}</Tag>
          <Tag tone={rc.isProvisional ? "warn" : "info"}>{rc.sourceLabel}</Tag>
        </div>
      </div>
      <p style={{ margin: "8px 0 0", fontSize: 12, color: MUTED }}>
        影響している患者質問: {rc.affectedQuestionCount}件
      </p>
      <details className="ds-details" style={{ marginTop: 10 }}>
        <summary>詳細を見る(対象質問・競合との差・根拠)</summary>
        <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
          {rc.questions.map((q, i) => (
            <div key={i} style={{ borderLeft: `3px solid ${BLUE}`, paddingLeft: 12 }}>
              <p style={{ margin: 0, fontSize: 13, color: NAVY }}>
                <strong>患者質問: </strong>
                {q.question}
              </p>
              <p style={{ margin: "4px 0 0", fontSize: 12, color: MUTED }}>
                <strong>競合との差: </strong>
                {q.competitorDifference.length > 0 ? q.competitorDifference.join("、") : "特になし"}
              </p>
              {q.evidence.length > 0 && (
                <div style={{ marginTop: 4 }}>
                  <span style={{ fontSize: 12, color: MUTED, fontWeight: 700 }}>根拠: </span>
                  <ul style={{ margin: "2px 0 0", paddingLeft: 18, color: MUTED, fontSize: 12 }}>
                    {q.evidence.map((e, j) => (
                      <li key={j}>
                        {e.text}
                        {e.providerLabel && (
                          <span style={{ color: "#9CA3AF" }}>
                            {" "}
                            ー {e.providerLabel}
                            {e.isSample ? "・参考データ" : ""}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

/**
 * 改善TOP3カード(2026-09-06のユーザー指示⑤)。常時表示は「順位バッジ + タイトル +
 * 『まずやること』1行」のみ。検出事実・想定される影響・インパクト/確度/緊急性・
 * データ不足はネイティブの<details>/<summary>で折りたたむ(JS不要・Server Componentの
 * ままで実装できるため)。impact/confidence/urgencyはresultViewModel.tsで
 * 「高/中/低」へ変換済みのラベル(ImprovementViewModel)を使い、high/medium/lowの
 * ような内部コードをそのまま表示しない。
 */
function ImprovementCard({
  rank,
  task,
  reportId,
  isOwner,
  selfServeMarkedAt,
}: {
  rank: number;
  task: ImprovementViewModel;
  reportId: string;
  isOwner: boolean;
  selfServeMarkedAt: Date | null;
}) {
  return (
    <div
      style={{
        border: `1px solid ${task.isCriticalRisk ? "#FECACA" : BORDER}`,
        background: task.isCriticalRisk ? "#FFFBFB" : undefined,
        borderRadius: 10,
        padding: 14,
      }}
    >
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        <span
          style={{
            flexShrink: 0,
            width: 22,
            height: 22,
            borderRadius: "50%",
            background: task.isCriticalRisk ? "#DC2626" : BLUE,
            color: "#fff",
            fontSize: 12,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {rank}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          {task.isCriticalRisk && (
            <div style={{ marginBottom: 6 }}>
              <Tag tone="danger">重大リスク</Tag>
            </div>
          )}
          {/* 2026-09-22最終修正: 改善TOP3を「課題/理由/最初に行う作業/期待できる改善領域/詳細を見る」で
              統一表示する。既存フィールド(title/detectedFact/firstAction/patientImpact)の
              呼び方を変えるだけで、新しいデータ・判定ロジックは追加しない。 */}
          <p style={{ margin: 0, fontWeight: 700, color: NAVY, fontSize: 14 }}>課題: {task.title}</p>
          <p style={{ fontSize: 12, color: "#374151", margin: "6px 0 0" }}>理由: {task.detectedFact}</p>
          <p style={{ fontSize: 12, color: "#374151", margin: "6px 0 0" }}>
            最初に行う作業: {task.firstAction}
          </p>
          <p style={{ fontSize: 12, color: "#374151", margin: "6px 0 0" }}>
            期待できる改善領域: {task.patientImpact}
          </p>
          {task.isCriticalRisk && task.criticalRiskReason && (
            <p style={{ fontSize: 12, color: "#991B1B", margin: "6px 0 0" }}>
              重大リスクの理由: {task.criticalRiskReason}
            </p>
          )}

          <details className="ds-details" style={{ marginTop: 8 }}>
            <summary>詳細を見る</summary>
            <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
              {task.dataGapReason && (
                <p style={{ fontSize: 12, color: "#D97706", margin: 0 }}>
                  データ不足: {task.dataGapReason}
                </p>
              )}
              <p style={{ fontSize: 11, color: MUTED, margin: 0 }}>
                インパクト: {task.impactLabel} / 確度: {task.confidenceLabel} / 緊急性: {task.urgencyLabel}
              </p>
              {isOwner && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
                  <SelfServeToggleButton
                    reportId={reportId}
                    improvementActionKey={task.key}
                    initiallyMarked={Boolean(selfServeMarkedAt)}
                  />
                  <InstructionPdfOrderButton reportId={reportId} improvementActionKey={task.key} />
                </div>
              )}
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}

function AdComplianceFindingCard({ f }: { f: AdComplianceFindingViewModel }) {
  const tone =
    f.visualTone === "sample"
      ? { bg: "#F9FAFB", border: BORDER, fg: MUTED }
      : { bg: "#FEF2F2", border: "#FECACA", fg: "#991B1B" };
  return (
    <details
      className="ds-details"
      style={{ border: `1px solid ${tone.border}`, background: tone.bg, borderRadius: 10, padding: 14 }}
    >
      <summary style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <Tag tone={f.visualTone === "sample" ? "muted" : "warn"}>{f.severityLabel}</Tag>
        <Tag tone="muted">{f.confidenceLabel}</Tag>
        {f.escalationEligible && <Tag tone="info">改善TOP3にも反映済み</Tag>}
        <span style={{ fontSize: 12, color: tone.fg, fontWeight: 400 }}>{f.displayMessage}</span>
      </summary>
      <div style={{ marginTop: 8 }}>
        <p style={{ margin: "6px 0 0", fontSize: 12, color: MUTED }}>{f.sourceLabel}</p>
        <p style={{ margin: "4px 0 0", fontSize: 12, color: MUTED }}>確認推奨: {f.requiresReviewBy}</p>
        {f.evidence.length > 0 && (
          <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 12, color: MUTED }}>
            {f.evidence.map((e, i) => (
              <li key={i}>
                「{e.quotedText}」({e.sourceLocation}) {e.isSampleEvidence ? "※サンプルデータ" : ""}
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

/**
 * 診断結果からTimeRexの45分相談予約へ進むCTA。
 *
 * 重要: 相談は任意であり、診断結果の閲覧やご契約の条件ではない(必ずその旨を明示する)。
 * TimeRexの予約ページURLはコードへ直書きせず、環境変数(NEXT_PUBLIC_SPECIALIST_BOOKING_URL)
 * から読み込む。未設定の場合は壊れたリンクを表示せず、CTA自体を描画しない
 * (2026-09-06の追加ユーザー指示⑥: 未設定時に空枠・余白を残さない)。
 * TimeRex API連携は今回のスコープ外(単なる外部リンクで十分、とのユーザー指示)。
 *
 * 表示する担当者名・アバター等は一切持たない(「AIスペシャリスト50名」のような具体的な
 * 実在人物風の見せ方をここでは行わない)。将来、実際の面談対応者(CS/専門スタッフ)や
 * AI生成モデルの人物表示を追加する場合は、実在人物との誤認を避けるため「AI生成モデル」の
 * 明示を必須にすること(ユーザー指示)。
 */
function ConsultationCta({
  diagnosisId,
  className,
  compact = false,
}: {
  diagnosisId: string;
  className?: string;
  compact?: boolean;
}) {
  const bookingUrl = process.env.NEXT_PUBLIC_SPECIALIST_BOOKING_URL;
  if (!bookingUrl) return null;

  return (
    <div
      className={className}
      style={{
        marginTop: compact ? 0 : 24,
        background: "#fff",
        border: `1px solid ${BORDER}`,
        borderRadius: 16,
        padding: compact ? 22 : 24,
        boxShadow: "0 1px 2px rgba(15,27,45,0.04)",
      }}
    >
      <p style={{ margin: 0, fontSize: 11, color: MUTED }}>
        相談は任意です。診断結果の閲覧・ご利用の条件ではありません。
      </p>
      <h2 style={{ margin: "8px 0 0", fontSize: compact ? 16 : 20, color: NAVY, fontWeight: 700 }}>
        この診断結果について相談する
      </h2>
      <p style={{ margin: "8px 0 0", fontSize: 12, color: "#374151", lineHeight: 1.65 }}>
        診断結果を見ながら、優先して改善すべき点をAI集患スペシャリストと一緒に整理します。
      </p>
      <p style={{ margin: "8px 0 0", fontSize: 12, color: "#1E3A8A", fontWeight: 600 }}>
        無料・45分。ご予約には医院担当者の電話番号が必要です。
      </p>
      <TrackedCtaLink
        diagnosisId={diagnosisId}
        eventType="online_consultation_clicked"
        href={bookingUrl}
        target="_blank"
        rel="noreferrer"
        aria-label="スペシャリストとの45分相談の空き日時を確認する"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          marginTop: 16,
          background: BLUE,
          color: "#fff",
          width: compact ? "100%" : "auto",
          padding: "11px 18px",
          borderRadius: 999,
          textDecoration: "none",
          fontWeight: 700,
          fontSize: 14,
        }}
      >
        診断結果について無料相談
      </TrackedCtaLink>
    </div>
  );
}

/**
 * 診断結果からDENT SHIFTの電話受付(IVRy想定)へのCTA。
 * ユーザー起点の問い合わせのみを想定し、DENT SHIFT側から営業電話は一切行わない
 * (指示書13章・最重要原則)。電話番号は環境変数(NEXT_PUBLIC_SUPPORT_PHONE_NUMBER)から
 * 読み込み、未設定時はCTA自体を描画しない(ConsultationCtaと同じ方針)。
 * IVRyの着信・通話結果連携はAPI/Webhook仕様が未確定のためP0スコープ外(指示書23章)。
 */
function PhoneInquiryCta({ diagnosisId }: { diagnosisId: string }) {
  const phoneNumber = process.env.NEXT_PUBLIC_SUPPORT_PHONE_NUMBER;
  if (!phoneNumber) return null;

  return (
    <div
      style={{
        marginTop: 16,
        background: "#F9FAFB",
        border: "1px solid #E5E7EB",
        borderRadius: 16,
        padding: 24,
      }}
    >
      <h2 style={{ margin: 0, fontSize: 16, color: NAVY, fontWeight: 700 }}>
        お電話でのお問い合わせ
      </h2>
      <p style={{ margin: "8px 0 0", fontSize: 13, color: "#374151", lineHeight: 1.7 }}>
        ご不明点があれば、お気軽にお電話ください。こちらからの営業電話は一切行いません。
      </p>
      <TrackedCtaLink
        diagnosisId={diagnosisId}
        eventType="phone_inquiry_clicked"
        href={`tel:${phoneNumber}`}
        aria-label={`${phoneNumber}へ電話する`}
        style={{
          display: "inline-block",
          marginTop: 16,
          background: "#fff",
          color: NAVY,
          border: `1px solid ${BLUE}`,
          padding: "11px 20px",
          borderRadius: 999,
          textDecoration: "none",
          fontWeight: 700,
          fontSize: 14,
        }}
      >
        {phoneNumber} に電話する
      </TrackedCtaLink>
    </div>
  );
}
