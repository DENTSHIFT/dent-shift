import type {
  CriterionScore,
  DomainAggregateStatus,
  DomainKey,
  DomainScore,
  OverallScoreStatus,
  UnavailableReason,
} from "@/domain/diagnosis/types";
import type {
  AioLossRootCauseKey,
  CompetitorClinic,
  PatientQuestionResult,
  QuestionOutcomeStatus,
} from "@/domain/competitor/types";
import { aggregateAioLossRootCauses } from "@/domain/competitor/aioLossAttribution";
import { computeShareOfVoice, type ShareOfVoiceResult } from "@/domain/competitor/shareOfVoice";
import type { ImpactLevel, ImprovementCandidate } from "@/domain/improvement-task/types";
import type { AdComplianceCheckResult, AdRiskFinding, AdRiskSeverity } from "@/domain/ad-compliance/types";
import { buildDataDisclaimer } from "@/domain/diagnosis/dataDisclaimer";

/**
 * 無料診断結果画面(src/app/diagnosis/result/[id]/page.tsx)向けのview-model構築ロジック。
 *
 * 目的(2026-09-05のユーザー指示「DENT SHIFT 無料診断結果画面の正式UI実装」):
 * - ページ(Server Component)からデータ整形・表示判断ロジックを分離し、React/JSXに依存しない
 *   純粋関数としてunit testできるようにする(このリポジトリにjsdom/testing-libraryが無いため、
 *   コンポーネントテストではなくこの層のロジックテストで表示ルールを検証する)。
 * - 「存在しないデータをUIのために捏造しない」という最重要ルールを、表示直前のこの層で
 *   機械的に強制する(unavailableReasonの日本語変換、mock/estimated/measuredの区別、
 *   競合医院にスコアを付与しない、等)。
 *
 * このファイルはロジック層(domain/server)の判定結果を「どう見せるか」だけを扱う。
 * 新しい事業ロジック(スコア算出・root cause判定・改善TOP3選定等)は一切追加しない。
 *
 * 2026-09-06の追加ユーザー指示(最終UX調整): 「[chatgpt] [gemini] [mock] / high / medium /
 * low等の内部表現をメイン表示ではそのまま出さない」ため、evidence文字列の角括弧タグ除去
 * (parseEvidenceForDisplay)、および改善TOP3のimpact/confidence/urgency(英語コード)を
 * 「高/中/低」へ変換するImprovementViewModelをこの層に追加する。いずれも表示直前の
 * 変換のみであり、診断ロジック・データ生成ロジック(runFreeDiagnosis.ts/各provider)には
 * 一切手を入れない。
 */

// unavailableReasonのUI変換(2026-09-05のユーザー指示。machine-readable値をそのまま
// 院長へ出さない)。値は7種類すべてユーザー指定の文言をそのまま使う。
export const UNAVAILABLE_REASON_LABEL_JA: Record<UnavailableReason, string> = {
  not_provided: "必要な情報が入力されていません",
  not_connected: "まだ連携されていません",
  permission_required: "再認証または権限の確認が必要です",
  insufficient_data: "評価に必要なデータが不足しています",
  temporarily_unavailable: "現在データを取得できません",
  fetch_failed: "データ取得に失敗しました",
  not_applicable: "今回の診断では対象外です",
};

const DOMAIN_LABEL: Record<DomainKey, string> = {
  AIO: "AIO(AI検索最適化)",
  MEO: "MEO(地図検索)",
  // 2026-09-29変更(PO承認): 表示ラベルのみ「SEO（検索エンジン上位表示）」に統一する
  // (内部ID・DB値のDomainKey="SEO"自体は変更しない。全角括弧で統一)。
  SEO: "SEO（検索エンジン上位表示）",
  LLMO: "LLMO(AI言語モデル最適化)",
  WEB_BOOKING: "Web予約",
  REVIEWS: "口コミ・信頼",
};

// ユーザー指示の記載順(AIO/MEO/SEO/LLMO/Web予約/口コミ・信頼)。DOMAIN_ORDER(scoreCriteria.ts)
// は算出ロジック側の都合の並びなので、表示専用にこの並びへ入れ替える(算出ロジックは変更しない)。
export const DOMAIN_DISPLAY_ORDER: DomainKey[] = ["AIO", "MEO", "SEO", "LLMO", "WEB_BOOKING", "REVIEWS"];

// 2026-09-27修正(PO指示): win/close/loseは「AIが自院を推薦したか」という自院単独の
// 実測結果であり、名前つき競合医院との比較ではない(近隣競合の実データ抽出は未実装、
// UnavailableCompetitorProvider参照)。「自院優勢」「競合優勢」という比較を断定する
// ラベルは誤解を招くため、自院がAIにどう表示されたかのみを表す表現に統一する。
const QUESTION_STATUS_LABEL: Record<QuestionOutcomeStatus, string> = {
  win: "AIで表示された",
  close: "もう一歩",
  lose: "表示されなかった",
  insufficient_data: "データ不足",
};

// AioLossConfidence / AdRiskConfidence はいずれも "high" | "medium" | "low" の同一値集合のため
// 表示ラベルを共有する(意味も「確度」で共通)。
const CONFIDENCE_LABEL: Record<"high" | "medium" | "low", string> = {
  high: "確度: 高",
  medium: "確度: 中",
  low: "確度: 低",
};

const AD_RISK_SEVERITY_LABEL: Record<AdRiskSeverity, string> = {
  high: "重要度: 高",
  medium: "重要度: 中",
  low: "重要度: 低",
};

// 2026-09-06のユーザー指示②: high/medium/lowのような内部コードを単独の日本語(高/中/低)へ。
// 改善TOP3のインパクト/確度/緊急性など、接頭辞なしの単独ラベルが必要な箇所で使う。
const LEVEL_LABEL_JA: Record<ImpactLevel, string> = {
  high: "高",
  medium: "中",
  low: "低",
};

// evidence文字列の先頭に埋め込まれたAIプロバイダー名タグの院長向けラベル。
const PROVIDER_LABEL_JA: Record<string, string> = {
  chatgpt: "ChatGPT",
  gemini: "Gemini",
};

export interface EvidenceViewModel {
  /** 角括弧タグ([chatgpt]/[mock]等)を取り除いた、院長がそのまま読める本文 */
  text: string;
  /** 由来AIの院長向けラベル(例: "ChatGPT")。タグが無い場合はnull。「詳細を見る」内でのみ表示する想定 */
  providerLabel: string | null;
  /** 参考データ(mock)由来かどうか。「詳細を見る」内で「参考データ」等として示す想定 */
  isSample: boolean;
}

/**
 * evidence文字列は`[chatgpt] [mock] "質問" への回答で...`のように、AIプロバイダー名と
 * データ種別(mock/live)を角括弧タグとして先頭に埋め込んだ形で保存されている
 * (runFreeDiagnosis.ts/各mock providerの既存フォーマット。診断ロジック・データ生成ロジック
 * そのものには一切手を入れない)。2026-09-06のユーザー指示②「[chatgpt] [gemini] [mock]
 * などの内部表現をメイン表示ではそのまま出さない」に対応するため、表示直前のこの層でのみ
 * 角括弧タグを取り除き、必要なら日本語ラベルとして構造化して返す(raw providerを見せる場合も
 * 「詳細を見る」内で翻訳済みラベルとして示す)。
 */
function parseEvidenceForDisplay(raw: string): EvidenceViewModel {
  let rest = raw;
  let providerTag: string | null = null;
  let isSample = false;

  const outer = rest.match(/^\[([^\]]+)\]\s*/);
  if (outer) {
    providerTag = outer[1] ?? null;
    rest = rest.slice(outer[0].length);
  }
  const inner = rest.match(/^\[([^\]]+)\]\s*/);
  if (inner) {
    if ((inner[1] ?? "").toLowerCase() === "mock") isSample = true;
    rest = rest.slice(inner[0].length);
  }

  return {
    text: rest,
    providerLabel: providerTag ? (PROVIDER_LABEL_JA[providerTag.toLowerCase()] ?? providerTag) : null,
    isSample,
  };
}

export interface DiagnosisResultData {
  clinicId: string;
  clinicName: string;
  clinicUrl: string;
  totalPoints: number;
  totalStatus: OverallScoreStatus;
  scoreBreakdown: { domains: DomainScore[]; maxPoints: number; assessedMaxPoints: number; coverage: number };
  competitors: CompetitorClinic[];
  // 2026-09-29追加(PO指示): 「現在の競合医院」の算出元となる生のAI観測(実データのみ)。
  aiObservations: CurrentCompetitorRawObservation[];
  questionResults: PatientQuestionResult[];
  topImprovements: ImprovementCandidate[];
  adComplianceChecks: AdComplianceCheckResult;
  isSample: boolean;
  dataDisclaimer: string;
  measuredAt: Date | string;
}

export interface SampleBannerViewModel {
  show: boolean;
  text: string;
}

/**
 * 2026-09-06のユーザー指示⑦: 「サンプル診断」であることは明確に維持しつつ、ページ全体が
 * 警告画面のように見えないよう文章量を少し抑える(意味は変更しない=サンプルデータが
 * 含まれる旨と、実データと異なりうる旨の2点は必ず残す)。
 *
 * 2026-09-29修正(PO承認): 黄色の警告バナー(ページ上部)を廃止し、ページ最下部の
 * 控えめな注記(グレー文字・警告色なし)へ変更する。法的・説明上必要な情報(サンプル・
 * 推定データが含まれる旨、実際の結果と異なりうる旨)は維持しつつ、スコアより目立たない
 * 扱いにする(承認済み文言をそのまま使用、タイトル+コロンの構成はやめ一文にする)。
 */
export function buildSampleBanner(isSample: boolean): SampleBannerViewModel {
  if (!isSample) {
    return { show: false, text: "" };
  }
  return {
    show: true,
    text:
      "本画面は表示イメージです。掲載内容には参考データおよび推定値が含まれており、実際の診断結果とは異なる場合があります。",
  };
}

export interface OverallScoreViewModel {
  points: number;
  maxPoints: number;
  statusCaveat: string | null;
  // 2026-09-27追加(PO承認): totalStatus自体をUIへ渡し、「全領域未測定」(unavailable)と
  // 「一部のみ測定」(partial/estimated)を明確に区別できるようにする。unavailableの場合、
  // 呼び出し側は0/100点等の数値・ゲージを一切表示せず、専用の文言へ差し替える。
  totalStatus: OverallScoreStatus;
}

export function buildOverallScoreViewModel(
  totalPoints: number,
  totalStatus: OverallScoreStatus,
  maxPoints: number
): OverallScoreViewModel {
  let statusCaveat: string | null = null;
  if (totalStatus === "partial") {
    statusCaveat = "一部の領域が未測定のため、暫定スコアです(未測定分は0点として扱っていません)";
  } else if (totalStatus === "estimated") {
    statusCaveat = "一部推定値を含むスコアです";
  } else if (totalStatus === "unavailable") {
    statusCaveat = "現在、算定可能な実測データが不足しています";
  }
  return { points: totalPoints, maxPoints, statusCaveat, totalStatus };
}

export interface DomainViewModel {
  domain: DomainKey;
  label: string;
  status: DomainAggregateStatus;
  pointsLabel: string;
  // measured/estimated/partialのときのみ0-100の数値(進捗バー表示用)。unavailableはnull
  // (「0」として表示しない、という最重要ルールをここでも徹底する)。
  percent: number | null;
  showEstimatedBadge: boolean;
  unavailableReasonLabel: string | null;
  partialNote: string | null;
}

function uniqueUnavailableReasonLabels(criteria: CriterionScore[]): string[] {
  const reasons = criteria
    .filter((c) => c.status === "unavailable" && c.unavailableReason !== null)
    .map((c) => c.unavailableReason as UnavailableReason);
  const unique = Array.from(new Set(reasons));
  return unique.map((r) => UNAVAILABLE_REASON_LABEL_JA[r]);
}

export function buildDomainViewModel(score: DomainScore): DomainViewModel {
  const label = DOMAIN_LABEL[score.domain];

  if (score.status === "unavailable") {
    const reasonLabels = uniqueUnavailableReasonLabels(score.criteria);
    const unavailableReasonLabel =
      reasonLabels.length === 1 ? (reasonLabels[0] as string) : "複数の要因により評価できません";
    return {
      domain: score.domain,
      label,
      status: score.status,
      // 「0」として表示しない(2026-09-05のユーザー指示「最重要ルール」)
      pointsLabel: "取得不能",
      percent: null,
      showEstimatedBadge: false,
      unavailableReasonLabel,
      partialNote: null,
    };
  }

  const unavailableCriteria = score.criteria.filter((c) => c.status === "unavailable");
  const partialNote =
    score.status === "partial" && unavailableCriteria.length > 0
      ? `一部の項目(${unavailableCriteria.length}件)が未測定です(${uniqueUnavailableReasonLabels(
          unavailableCriteria
        ).join("・")})。取得できた項目のみで集計しています。`
      : null;

  return {
    domain: score.domain,
    label,
    status: score.status,
    pointsLabel: `${score.points} / ${score.maxPoints}点`,
    percent: score.maxPoints > 0 ? Math.max(0, Math.min(100, (score.points / score.maxPoints) * 100)) : 0,
    showEstimatedBadge: score.status === "estimated",
    unavailableReasonLabel: null,
    partialNote,
  };
}

export function buildDomainViewModels(domains: DomainScore[]): DomainViewModel[] {
  const byDomain = new Map(domains.map((d) => [d.domain, d]));
  return DOMAIN_DISPLAY_ORDER.filter((d) => byDomain.has(d)).map((d) =>
    buildDomainViewModel(byDomain.get(d) as DomainScore)
  );
}

export interface QuestionResultViewModel {
  question: string;
  status: QuestionOutcomeStatus;
  statusLabel: string;
  captionLabel: string | null;
  dataSourceLabel: string;
  dataSourceTone: "info" | "warn" | "muted";
  evidence: EvidenceViewModel[];
}

/**
 * 質問単位の判定元を院長向けの表示へ変換する。
 * statusSource/measurementCoverageの既存値だけを使い、欠損値を実測へ推測変換しない。
 */
export function buildQuestionDataSourceViewModel(
  result: PatientQuestionResult
): Pick<QuestionResultViewModel, "dataSourceLabel" | "dataSourceTone"> {
  if (result.statusSource !== "canonical_measurement") {
    // legacy_referenceと、statusSource追加前の既存診断はいずれも実測とは表示しない。
    return { dataSourceLabel: "参考データ", dataSourceTone: "warn" };
  }

  const coverage = result.measurementCoverage;
  if (!coverage || coverage.totalProviders === 0) {
    return { dataSourceLabel: "取得状況不明", dataSourceTone: "muted" };
  }
  if (coverage.measuredProviders === coverage.totalProviders) {
    return { dataSourceLabel: "実測データ", dataSourceTone: "info" };
  }
  if (coverage.measuredProviders > 0) {
    return { dataSourceLabel: "一部実測", dataSourceTone: "warn" };
  }
  if (coverage.referenceProviders === coverage.totalProviders) {
    return { dataSourceLabel: "参考データ", dataSourceTone: "warn" };
  }
  if (coverage.unavailableProviders === coverage.totalProviders) {
    return { dataSourceLabel: "取得不能", dataSourceTone: "muted" };
  }
  return { dataSourceLabel: "参考・取得不能", dataSourceTone: "muted" };
}

export function buildQuestionResultViewModel(result: PatientQuestionResult): QuestionResultViewModel {
  const captionLabel =
    result.status === "insufficient_data" && result.unavailableReason !== null
      ? UNAVAILABLE_REASON_LABEL_JA[result.unavailableReason]
      : null;
  const dataSource = buildQuestionDataSourceViewModel(result);
  return {
    question: result.question,
    status: result.status,
    statusLabel: QUESTION_STATUS_LABEL[result.status],
    captionLabel,
    ...dataSource,
    evidence: result.evidence.map(parseEvidenceForDisplay),
  };
}

export function buildQuestionResultViewModels(
  results: PatientQuestionResult[]
): QuestionResultViewModel[] {
  return results.map(buildQuestionResultViewModel);
}

export interface LossRootCauseQuestionViewModel {
  question: string;
  competitorDifference: string[];
  evidence: EvidenceViewModel[];
}

export interface LossRootCauseViewModel {
  rootCauseKey: AioLossRootCauseKey;
  rootCauseLabel: string;
  confidenceLabel: string;
  isProvisional: boolean;
  sourceLabel: string;
  affectedQuestionCount: number;
  questions: LossRootCauseQuestionViewModel[];
}

/**
 * 「なぜ負けている?」root cause TOP3を、保存済みquestionResultsから都度再集約して構築する
 * (2026-09-05のユーザー指示: 集約TOP3が永続化されていない場合はaggregateAioLossRootCauses()
 * で再集約する。getDiagnosisById()自体はこの集約を行わないため、表示直前のこの層で行う)。
 *
 * 表示構造(ユーザー指示どおり): 患者質問 → 競合との差 → なぜ負けているか → 根拠
 * が追える形にするため、各root causeのlinkedQuestionsを実際のquestionResultsへ
 * 突き合わせ、質問ごとのcompetitorDifference/evidenceを保持する。
 *
 * sourceLabel(2026-09-06の追加ユーザー指示④「参考データか実測か」)はisProvisionalから
 * 機械的に導出するのみで、新しい判定を追加しない。
 */
export function buildLossRootCauseViewModels(
  questionResults: PatientQuestionResult[]
): LossRootCauseViewModel[] {
  const summaries = aggregateAioLossRootCauses(questionResults);
  const byQuestion = new Map(questionResults.map((q) => [q.question, q]));

  return summaries.map((summary) => ({
    rootCauseKey: summary.rootCauseKey,
    rootCauseLabel: summary.rootCauseLabel,
    confidenceLabel: CONFIDENCE_LABEL[summary.confidence],
    isProvisional: summary.isProvisional,
    sourceLabel: summary.isProvisional ? "参考データ" : "実測データ",
    affectedQuestionCount: summary.affectedQuestionCount,
    questions: summary.linkedQuestions.map((question) => {
      const qr = byQuestion.get(question);
      return {
        question,
        competitorDifference: qr?.competitorDifference ?? [],
        evidence: (qr?.evidence ?? []).map(parseEvidenceForDisplay),
      };
    }),
  }));
}

export interface CompetitorViewModel {
  name: string;
  url: string | null;
  distanceLabel: string | null;
}

/**
 * 競合医院は一覧(名称/URL/距離)としてのみ表示する。競合自身の総合スコアは算出していない
 * (CompetitorClinic型にscoreフィールドが存在しない)ため、スコア比較の棒グラフ等は作らない
 * (2026-09-05のユーザー指示「最重要ルール」: 存在しないデータを捏造しない)。
 */
export function buildCompetitorViewModels(competitors: CompetitorClinic[]): CompetitorViewModel[] {
  return competitors.map((c) => ({
    name: c.name,
    url: c.url ?? null,
    distanceLabel: typeof c.distanceKm === "number" ? `${c.distanceKm.toFixed(1)}km圏内` : null,
  }));
}

// 2026-09-29追加(PO指示): 「現在の競合医院」向けのAIプロバイダー内部識別子→院長向け表示名。
// AiObservation.providerに保存される値("openai"等)を対象とする(既存PROVIDER_LABEL_JAは
// evidence文字列内タグ("chatgpt"等)用の別語彙のため、ここでは混同せず専用の対応表を持つ)。
const CURRENT_COMPETITOR_PROVIDER_LABEL_JA: Record<string, string> = {
  openai: "ChatGPT",
  gemini: "Gemini",
};

export interface CurrentCompetitorRawObservation {
  question: string;
  aiProvider: string;
  competitorMentions: string[] | null;
  capturedAt: Date | string;
  // 2026-09-29追加(PO指示): AIO測定メタ情報(取得不能数)の算出にも同じ生観測を使う。
  mentioned: boolean | null;
}

export interface CurrentCompetitorViewModel {
  /** AI応答本文に実際に出現した名称そのもの(捏造・推測は一切含まない)。 */
  name: string;
  /** この名称が言及された、重複のない質問数。 */
  mentionedQuestionCount: number;
  /** この名称が言及された質問一覧(根拠質問への遷移用)。 */
  mentionedQuestions: string[];
  /** 測定に使われたAIプロバイダー(表示名)の一覧(重複排除)。 */
  measurementProviders: string[];
  /** 最も新しい測定日時(ISO文字列)。 */
  measuredAt: string;
}

/**
 * 「現在の競合医院」(2026-09-29追加、PO指示)。
 *
 * AiObservation.competitorsJson(実際にOpenAIの応答本文から検出された名称候補、
 * competitorCandidateExtraction.tsが自院名を除外済みの実データ)だけを入力とする。
 * ダミー名・推測名・架空名は一切生成しない(候補データが無ければ空配列を返すのみ)。
 *
 * 表記ゆれの正規化(normalizeForMatchingと同じ全角/半角統一・空白正規化)をキーにして
 * 重複排除し、同一名称が複数質問で言及された場合は1件へ集約して言及質問数を集計する。
 * 表示名(name)は正規化前の最初の出現時点の表記をそのまま使う(捏造しない)。
 */
export function buildCurrentCompetitorViewModels(
  observations: CurrentCompetitorRawObservation[]
): CurrentCompetitorViewModel[] {
  // resultViewModel.tsは純粋なview-model層のため、normalizeForMatching自体は
  // ここでは再実装せず、全角/半角・空白差だけを吸収する最小限の正規化に留める
  // (このファイルからdomain/ai-measurement配下への依存を増やさないための判断。
  // 実際の名寄せ精度はcompetitorCandidateExtraction.ts側の抽出品質に依る)。
  const normalize = (name: string): string =>
    name
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
      .replace(/[\s　]+/g, "")
      .trim();

  interface Aggregate {
    name: string;
    questions: Set<string>;
    providers: Set<string>;
    latestMeasuredAt: Date;
  }
  const byNormalizedName = new Map<string, Aggregate>();

  for (const obs of observations) {
    if (!obs.competitorMentions || obs.competitorMentions.length === 0) continue;
    const providerLabel = CURRENT_COMPETITOR_PROVIDER_LABEL_JA[obs.aiProvider] ?? obs.aiProvider;
    const capturedAt = obs.capturedAt instanceof Date ? obs.capturedAt : new Date(obs.capturedAt);
    for (const rawName of obs.competitorMentions) {
      const trimmed = rawName.trim();
      if (trimmed.length === 0) continue;
      const key = normalize(trimmed);
      if (key.length === 0) continue;
      const existing = byNormalizedName.get(key);
      if (existing) {
        existing.questions.add(obs.question);
        existing.providers.add(providerLabel);
        if (capturedAt > existing.latestMeasuredAt) existing.latestMeasuredAt = capturedAt;
      } else {
        byNormalizedName.set(key, {
          name: trimmed,
          questions: new Set([obs.question]),
          providers: new Set([providerLabel]),
          latestMeasuredAt: capturedAt,
        });
      }
    }
  }

  return Array.from(byNormalizedName.values())
    .map((agg) => ({
      name: agg.name,
      mentionedQuestionCount: agg.questions.size,
      mentionedQuestions: Array.from(agg.questions),
      measurementProviders: Array.from(agg.providers),
      measuredAt: agg.latestMeasuredAt.toISOString(),
    }))
    // 言及質問数の多い順(同数の場合は名称の出現順を維持するためMapの挿入順に依存)。
    .sort((a, b) => b.mentionedQuestionCount - a.mentionedQuestionCount);
}

export interface AdComplianceEvidenceViewModel {
  quotedText: string;
  sourceLocation: string;
  detectionReason: string;
  isSampleEvidence: boolean;
}

export interface AdComplianceFindingViewModel {
  id: string;
  severityLabel: string;
  // mock由来(provisional)の所見は、severityの見た目上の強さに関わらず警戒色を使わない
  // (2026-09-05のユーザー指示: mock由来の警告を実際に検出された重大リスクのように表示しない)。
  visualTone: "risk" | "sample";
  confidenceLabel: string;
  displayMessage: string;
  requiresReviewBy: string;
  sourceLabel: string;
  isProvisional: boolean;
  escalationEligible: boolean;
  evidence: AdComplianceEvidenceViewModel[];
}

function buildAdComplianceFindingViewModel(finding: AdRiskFinding): AdComplianceFindingViewModel {
  return {
    id: finding.id,
    severityLabel: AD_RISK_SEVERITY_LABEL[finding.severity],
    visualTone: finding.provisional ? "sample" : "risk",
    confidenceLabel: CONFIDENCE_LABEL[finding.confidence],
    displayMessage: finding.displayMessage,
    requiresReviewBy: finding.requiresReviewBy,
    sourceLabel: finding.sourceLabel,
    isProvisional: finding.provisional,
    escalationEligible: finding.escalationEligible,
    evidence: finding.evidence.map((e) => ({
      quotedText: e.quotedText,
      sourceLocation: e.sourceLocation,
      detectionReason: e.detectionReason,
      isSampleEvidence: e.sourceType === "mock",
    })),
  };
}

export interface AdComplianceViewModel {
  disclaimer: string;
  findings: AdComplianceFindingViewModel[];
}

export function buildAdComplianceViewModel(result: AdComplianceCheckResult): AdComplianceViewModel {
  return {
    disclaimer: result.disclaimer,
    findings: result.findings.map(buildAdComplianceFindingViewModel),
  };
}

/**
 * 改善TOP3カードのview-model(2026-09-06の追加ユーザー指示⑤)。
 * 「順位・タイトル・まずやること」を最優先に読める主表示にするため、
 * recommendedAction(推奨アクション)を「まずやること」の1行として抜き出し、
 * detectedFact/patientImpact/impact・confidence・urgency(高中低へ変換)/dataGapは
 * 「詳細を見る」側で使う値としてまとめて保持する。ImprovementCandidate自体の
 * フィールド・生成ロジックは一切変更しない(表示直前の並べ替え・ラベル変換のみ)。
 */
export interface ImprovementViewModel {
  key: string;
  title: string;
  firstAction: string;
  patientImpact: string;
  detectedFact: string;
  impactLabel: string;
  confidenceLabel: string;
  urgencyLabel: string;
  dataGapReason: string | null;
  // 2026-09-22: kind==="risk_escalation"の候補を画面上で区別表示するため
  // (ドメイン層では既に優先度付けされていたが、UIのview-modelがkindを
  // 保持しておらず区別できていなかった)。
  isCriticalRisk: boolean;
  criticalRiskReason: string | null;
}

export function buildImprovementViewModel(task: ImprovementCandidate): ImprovementViewModel {
  return {
    key: task.key,
    title: task.title,
    firstAction: task.recommendedAction,
    patientImpact: task.patientImpact,
    detectedFact: task.detectedFact,
    impactLabel: LEVEL_LABEL_JA[task.impact],
    confidenceLabel: LEVEL_LABEL_JA[task.confidence],
    urgencyLabel: LEVEL_LABEL_JA[task.urgency],
    dataGapReason: task.dataGap?.reason ?? null,
    isCriticalRisk: task.kind === "risk_escalation",
    criticalRiskReason: task.kind === "risk_escalation" ? (task.escalation?.reason ?? null) : null,
  };
}

export function buildImprovementViewModels(tasks: ImprovementCandidate[]): ImprovementViewModel[] {
  return tasks.map(buildImprovementViewModel);
}

export interface MeasurementViewModel {
  measuredAtIso: string;
  /**
   * 院長向けの簡潔な要約文(2026-09-06の追加ユーザー指示⑧「専門用語はできるだけ院長向けに」)。
   * runFreeDiagnosis.tsが取得状況に応じて返す詳細なdataDisclaimer文字列を、そのまま
   * 画面のメイン表示には出さない。
   */
  summaryLabel: string;
  /** 元のdataDisclaimer文字列(生データ)。「詳細を見る」内でのみ表示する想定。 */
  technicalDisclaimer: string;
  domainSourceSummary: string;
  /**
   * 2026-09-29追加(PO指示: ダッシュボード「取得状況」の円グラフ化)。既存のstatus集計
   * (measured/estimated/partial/unavailable)を、推測値を作らずそのまま件数として公開する。
   * 呼び出し側で円グラフを描く場合、独自の判定は行わずこの値をそのまま使うこと。
   */
  domainStatusCounts: Record<DomainAggregateStatus, number>;
}

/**
 * 「計測条件・計測日時・データソース」表示用。各領域のstatus(measured/estimated/
 * partial/unavailable)を件数集計し、院長が「どこまで実測でどこからが推定/未取得か」を
 * 一目で把握できるようにする(新しい判定ロジックは持たず、既存statusの集計のみ)。
 */
export function buildMeasurementViewModel(
  measuredAt: Date | string,
  dataDisclaimer: string,
  domains: DomainScore[],
  isSample: boolean
): MeasurementViewModel {
  const measuredAtIso = typeof measuredAt === "string" ? measuredAt : measuredAt.toISOString();
  const counts: Record<DomainAggregateStatus, number> = {
    measured: 0,
    estimated: 0,
    partial: 0,
    unavailable: 0,
  };
  for (const d of domains) counts[d.status] += 1;

  const parts: string[] = [];
  if (counts.measured > 0) parts.push(`実測${counts.measured}領域`);
  if (counts.estimated > 0) parts.push(`推定${counts.estimated}領域`);
  if (counts.partial > 0) parts.push(`一部取得${counts.partial}領域`);
  if (counts.unavailable > 0) parts.push(`取得不能${counts.unavailable}領域`);

  const summaryLabel = isSample
    ? "この結果には参考データ(サンプル・推定値)が含まれています。実際の集患成果を保証するものではありません。"
    : "実際のデータに基づく計測結果です。数値は集患成果を保証するものではありません。";

  return {
    measuredAtIso,
    summaryLabel,
    technicalDisclaimer: dataDisclaimer,
    domainSourceSummary: parts.join(" / ") || "データソース情報がありません",
    domainStatusCounts: counts,
  };
}

// 2026-09-29追加(PO指示、10/1 P0範囲): AIOの測定メタ情報(プロバイダー・質問数・
// 測定日時・取得不能数)を院長向けに明示する。Gemini/Google AIは実装が存在しないため、
// 「実測済み」として表示するのはOpenAI(ChatGPT)の観測のみとする。
const AIO_PROVIDER_LABEL_JA: Record<string, string> = {
  openai: "ChatGPT",
  chatgpt: "ChatGPT",
  gemini: "Gemini",
};

export interface AioMeasurementRawObservation {
  aiProvider: string;
  /** null = provider障害等で取得不能(非言及と混同しない)。 */
  mentioned: boolean | null;
  capturedAt: Date | string;
}

export interface AioMeasurementSummaryViewModel {
  /** 実際に測定を行ったプロバイダーの表示名一覧(重複排除)。観測が0件ならから配列。 */
  providers: string[];
  /** 対象質問数(=観測件数)。 */
  questionCount: number;
  /** 取得不能だった件数(provider障害等でmentionedがnullだった観測)。 */
  unavailableCount: number;
  /** 最も新しい測定日時(ISO文字列)。観測が0件ならnull。 */
  measuredAtIso: string | null;
}

/**
 * AIOの測定メタ情報を集計する(捏造せず、実際のaiObservationsだけから機械的に算出)。
 */
export function buildAioMeasurementSummary(
  observations: AioMeasurementRawObservation[]
): AioMeasurementSummaryViewModel {
  const providers = new Set<string>();
  let unavailableCount = 0;
  let latest: Date | null = null;
  for (const obs of observations) {
    providers.add(AIO_PROVIDER_LABEL_JA[obs.aiProvider] ?? obs.aiProvider);
    if (obs.mentioned === null) unavailableCount += 1;
    const capturedAt = obs.capturedAt instanceof Date ? obs.capturedAt : new Date(obs.capturedAt);
    if (!latest || capturedAt > latest) latest = capturedAt;
  }
  return {
    providers: Array.from(providers),
    questionCount: observations.length,
    unavailableCount,
    measuredAtIso: latest ? latest.toISOString() : null,
  };
}

const LEGACY_DISCLAIMER_MARKERS = [
  "P0開発中のモックデータです",
  "実プロバイダーには接続していません",
] as const;

/**
 * 実AI計測の導入前に保存された固定注意書きだけを、現在の質問別取得状況に合わせて
 * 表示時に補正する。新しい注意書きや任意の保存文言は変更しない。
 */
export function normalizeLegacyDataDisclaimer(
  dataDisclaimer: string,
  questionResults: PatientQuestionResult[],
  isSample: boolean
): string {
  const isLegacy = LEGACY_DISCLAIMER_MARKERS.some((marker) => dataDisclaimer.includes(marker));
  if (!isLegacy) return dataDisclaimer;

  const statuses: Array<{ measurementStatus: "measured" | "reference" | "unavailable" }> = [];
  for (const result of questionResults) {
    const coverage = result.measurementCoverage;
    if (!coverage) continue;
    if (coverage.measuredProviders > 0) statuses.push({ measurementStatus: "measured" });
    if (coverage.referenceProviders > 0) statuses.push({ measurementStatus: "reference" });
    if (coverage.unavailableProviders > 0) statuses.push({ measurementStatus: "unavailable" });
  }

  return buildDataDisclaimer(isSample, statuses.length > 0 ? statuses : undefined);
}

export interface FreeDiagnosisResultViewModel {
  clinicName: string;
  clinicUrl: string;
  sampleBanner: SampleBannerViewModel;
  overall: OverallScoreViewModel;
  shareOfVoice: ShareOfVoiceResult;
  domains: DomainViewModel[];
  questionResults: QuestionResultViewModel[];
  lossRootCauses: LossRootCauseViewModel[];
  topImprovements: ImprovementViewModel[];
  competitors: CompetitorViewModel[];
  // 2026-09-29追加(PO指示): 「現在の競合医院」。旧competitors(UnavailableCompetitorProvider
  // 由来、常に空)とは別の、実際のAI応答から検出された名称のみを持つ一覧。
  currentCompetitors: CurrentCompetitorViewModel[];
  // 2026-09-29追加(PO指示、10/1 P0範囲): AIOの測定メタ情報(プロバイダー/質問数/日時/取得不能数)。
  aioMeasurement: AioMeasurementSummaryViewModel;
  adCompliance: AdComplianceViewModel;
  measurement: MeasurementViewModel;
}

export function buildFreeDiagnosisResultViewModel(
  diagnosis: DiagnosisResultData
): FreeDiagnosisResultViewModel {
  return {
    clinicName: diagnosis.clinicName,
    clinicUrl: diagnosis.clinicUrl,
    sampleBanner: buildSampleBanner(diagnosis.isSample),
    overall: buildOverallScoreViewModel(
      diagnosis.totalPoints,
      diagnosis.totalStatus,
      diagnosis.scoreBreakdown.maxPoints
    ),
    shareOfVoice: computeShareOfVoice(diagnosis.questionResults),
    domains: buildDomainViewModels(diagnosis.scoreBreakdown.domains),
    questionResults: buildQuestionResultViewModels(diagnosis.questionResults),
    lossRootCauses: buildLossRootCauseViewModels(diagnosis.questionResults),
    topImprovements: buildImprovementViewModels(diagnosis.topImprovements),
    competitors: buildCompetitorViewModels(diagnosis.competitors),
    currentCompetitors: buildCurrentCompetitorViewModels(diagnosis.aiObservations),
    aioMeasurement: buildAioMeasurementSummary(diagnosis.aiObservations),
    adCompliance: buildAdComplianceViewModel(diagnosis.adComplianceChecks),
    measurement: buildMeasurementViewModel(
      diagnosis.measuredAt,
      normalizeLegacyDataDisclaimer(
        diagnosis.dataDisclaimer,
        diagnosis.questionResults,
        diagnosis.isSample
      ),
      diagnosis.scoreBreakdown.domains,
      diagnosis.isSample
    ),
  };
}
