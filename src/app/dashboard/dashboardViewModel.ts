import type { DomainKey, DomainScore, OverallScoreStatus } from "@/domain/diagnosis/types";
import {
  buildFreeDiagnosisResultViewModel,
  type DiagnosisResultData,
  type FreeDiagnosisResultViewModel,
} from "@/app/diagnosis/result/[id]/resultViewModel";

export interface DashboardDiagnosisSummary {
  id: string;
  totalPoints: number;
  totalStatus: OverallScoreStatus;
  measuredAt: Date | string;
  isSample: boolean;
}

export interface DashboardQuestionSummary {
  displayGood: number;
  comparable: number;
  needsImprovement: number;
  insufficientData: number;
}

export interface DashboardTrendViewModel {
  label: string;
  tone: "positive" | "negative" | "neutral";
}

// 2026-09-29追加(PO指示、再診断ループP0): AIO/LLMOなど領域単位で「前回比」を出すための
// 最小view-model。高度な推移グラフは作らず、「前回比 +N/-N/±0」のラベル1つと、
// 比較不能な理由(未測定・サンプル混在等)の中立ラベルだけを持つ。測定日時は
// latestMeasuredAt/previousMeasuredAtとしてそのまま保持し、表示側で整形する。
export interface DashboardDomainTrendViewModel {
  domain: DomainKey;
  trend: DashboardTrendViewModel;
  latestMeasuredAt: Date | string | null;
  previousMeasuredAt: Date | string | null;
}

export type DashboardViewModel =
  | {
      hasDiagnosis: false;
      history: DashboardDiagnosisSummary[];
    }
  | {
      hasDiagnosis: true;
      latestId: string;
      result: FreeDiagnosisResultViewModel;
      trend: DashboardTrendViewModel;
      // 2026-09-29追加: AIO/LLMOの領域単位の前回比(比較不能な領域は含まれない)。
      domainTrends: DashboardDomainTrendViewModel[];
      questionSummary: DashboardQuestionSummary;
      history: DashboardDiagnosisSummary[];
    };

function buildTrend(
  latest: DashboardDiagnosisSummary,
  previous: DashboardDiagnosisSummary | undefined
): DashboardTrendViewModel {
  if (!previous) {
    return { label: "比較データなし", tone: "neutral" };
  }

  if (latest.totalStatus === "unavailable" || previous.totalStatus === "unavailable") {
    return { label: "取得状況により比較できません", tone: "neutral" };
  }

  // サンプルと実測の点数差を「改善」と誤認させない。
  if (latest.isSample !== previous.isSample) {
    return { label: "測定条件が異なるため比較なし", tone: "neutral" };
  }

  const difference = latest.totalPoints - previous.totalPoints;
  const prefix = latest.isSample ? "参考値の前回比" : "前回比";
  if (difference === 0) {
    return { label: `${prefix} ±0`, tone: "neutral" };
  }
  return {
    label: `${prefix} ${difference > 0 ? "+" : ""}${difference}`,
    tone: difference > 0 ? "positive" : "negative",
  };
}

function buildQuestionSummary(result: FreeDiagnosisResultViewModel): DashboardQuestionSummary {
  return result.questionResults.reduce<DashboardQuestionSummary>(
    (summary, question) => {
      if (question.status === "win") summary.displayGood += 1;
      if (question.status === "close") summary.comparable += 1;
      if (question.status === "lose") summary.needsImprovement += 1;
      if (question.status === "insufficient_data") summary.insufficientData += 1;
      return summary;
    },
    { displayGood: 0, comparable: 0, needsImprovement: 0, insufficientData: 0 }
  );
}

// 2026-09-29追加(PO指示、再診断ループP0): AIO/LLMOだけ、領域単位の「前回比」を出す
// (他4領域は現時点で実測連携が無く比較の意味が薄いため対象外。将来実測が増えたら
// このリストを拡張するだけでよい設計にする)。
const DOMAIN_TREND_TARGETS: DomainKey[] = ["AIO", "LLMO"];

/**
 * 領域単位の前回比を算出する。全体のbuildTrend()と同じ判断基準を領域単位に適用する:
 * - 前回診断が無い/取得不能(assessedMaxPoints=0、status="unavailable")な領域は比較しない
 *   (未測定項目同士を0点として差分計算しない、というPO指示をここで機械的に保証する)
 * - サンプル/実測の混在は比較しない(全体trendと同じ理由)
 */
function buildDomainTrend(
  domain: DomainKey,
  latestDomain: DomainScore | undefined,
  previousDomain: DomainScore | undefined,
  latestIsSample: boolean,
  previousIsSample: boolean
): DashboardTrendViewModel | null {
  if (!latestDomain || !previousDomain) return null;
  if (latestDomain.status === "unavailable" || previousDomain.status === "unavailable") return null;
  if (latestIsSample !== previousIsSample) return null;

  const difference = latestDomain.points - previousDomain.points;
  const prefix = latestIsSample ? "参考値の前回比" : "前回比";
  if (difference === 0) {
    return { label: `${prefix} ±0`, tone: "neutral" };
  }
  return {
    label: `${prefix} ${difference > 0 ? "+" : ""}${difference}`,
    tone: difference > 0 ? "positive" : "negative",
  };
}

function buildDomainTrends(
  latest: DiagnosisResultData,
  previous: { diagnosis: DiagnosisResultData } | undefined
): DashboardDomainTrendViewModel[] {
  if (!previous) return [];
  const trends: DashboardDomainTrendViewModel[] = [];
  for (const domain of DOMAIN_TREND_TARGETS) {
    const latestDomain = latest.scoreBreakdown.domains.find((d) => d.domain === domain);
    const previousDomain = previous.diagnosis.scoreBreakdown.domains.find((d) => d.domain === domain);
    const trend = buildDomainTrend(
      domain,
      latestDomain,
      previousDomain,
      latest.isSample,
      previous.diagnosis.isSample
    );
    if (trend) {
      trends.push({
        domain,
        trend,
        latestMeasuredAt: latest.measuredAt,
        previousMeasuredAt: previous.diagnosis.measuredAt,
      });
    }
  }
  return trends;
}

export function buildDashboardViewModel(
  latest: { id: string; diagnosis: DiagnosisResultData } | null,
  history: DashboardDiagnosisSummary[],
  previous?: { id: string; diagnosis: DiagnosisResultData }
): DashboardViewModel {
  if (!latest) {
    return { hasDiagnosis: false, history };
  }

  const result = buildFreeDiagnosisResultViewModel(latest.diagnosis);
  const latestSummary = history.find((diagnosis) => diagnosis.id === latest.id) ?? {
    id: latest.id,
    totalPoints: latest.diagnosis.totalPoints,
    totalStatus: latest.diagnosis.totalStatus,
    measuredAt: latest.diagnosis.measuredAt,
    isSample: latest.diagnosis.isSample,
  };
  const previousSummary = history.find((diagnosis) => diagnosis.id !== latest.id);

  return {
    hasDiagnosis: true,
    latestId: latest.id,
    result,
    trend: buildTrend(latestSummary, previousSummary),
    domainTrends: buildDomainTrends(latest.diagnosis, previous),
    questionSummary: buildQuestionSummary(result),
    history,
  };
}
