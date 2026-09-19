import type { OverallScoreStatus } from "@/domain/diagnosis/types";
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

export function buildDashboardViewModel(
  latest: { id: string; diagnosis: DiagnosisResultData } | null,
  history: DashboardDiagnosisSummary[]
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
  const previous = history.find((diagnosis) => diagnosis.id !== latest.id);

  return {
    hasDiagnosis: true,
    latestId: latest.id,
    result,
    trend: buildTrend(latestSummary, previous),
    questionSummary: buildQuestionSummary(result),
    history,
  };
}
