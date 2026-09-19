import type { PatientQuestionResult } from "./types";

/**
 * AI推薦シェア(Share of Voice)。患者質問のうち、自院がAIに優位に推薦されている
 * 割合を示す(P0_ACCEPTANCE.md「権限・監査」節と並ぶ最後の未達成項目、2026-09-20実装)。
 *
 * 既存のPatientQuestionResult(win/close/lose/insufficient_data)から都度再集約する
 * 純粋関数とし、新規のDB永続化・計測は行わない(改善TOP3・root cause集約と同じ方針)。
 *
 * 算出ルール:
 * - 分母(measuredQuestionCount) = insufficient_data以外のquestionResults件数
 * - 分子(winCount) = status==="win"の件数(closeは「拮抗」であり優位推薦とは数えない)
 * - 分母が0件(全質問がinsufficient_data)の場合は"insufficient_data"とし、
 *   0%ではなくnullを返す(取得不能値を0として扱わない、プロジェクト一貫の方針)。
 */
export interface ShareOfVoiceResult {
  status: "measured" | "insufficient_data";
  winCount: number;
  measuredQuestionCount: number;
  /** 0-100の整数。status==="insufficient_data"のときは必ずnull。 */
  percentage: number | null;
}

export function computeShareOfVoice(questionResults: PatientQuestionResult[]): ShareOfVoiceResult {
  const measured = questionResults.filter((q) => q.status !== "insufficient_data");
  const winCount = measured.filter((q) => q.status === "win").length;

  if (measured.length === 0) {
    return { status: "insufficient_data", winCount: 0, measuredQuestionCount: 0, percentage: null };
  }

  return {
    status: "measured",
    winCount,
    measuredQuestionCount: measured.length,
    percentage: Math.round((winCount / measured.length) * 100),
  };
}
