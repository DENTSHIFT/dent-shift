import type { QuestionOutcomeStatus } from "@/domain/competitor/types";
import type { AiMeasurementObservation } from "./types";

/**
 * canonical AI計測観測から質問単位のwin/close/lose/insufficient_dataを算出する
 * (2026-09-07のユーザー指示: win/close/loseへのcanonical measurement本接続ラウンド)。
 *
 * 呼び出し側(runFreeDiagnosis.ts)の責務:
 * - この関数へ渡すobservationsは、必ずmeasurementStatus==="measured"のものだけに
 *   事前フィルタしておくこと(reference/unavailableをこの関数へ混ぜない。混ぜないことの
 *   保証は呼び出し側の責務であり、この関数自体はmeasurementStatusを見ない)。
 * - observations.length === 0(=このrunでmeasuredなcanonical観測が1件も無い、
 *   ユーザー指示でいう「measuredProviders===0」)の場合、legacy mockへのfallbackは
 *   一切行わず、無条件で"insufficient_data"を返す。
 *
 * 判定ロジック自体は、既存legacy計算(runFreeDiagnosis.ts buildQuestionResults()内の
 * mentionedCount/bestRankベースのstatus算出)と完全に同一の意味を持つ。ユーザー指示
 * 「既存のwin/close/loseルールを勝手に再定義しないこと」に従い、canonical用に新しい
 * ルールを作らず、legacyのstatusの"意味"をそのままcanonical観測の型に対して再適用する
 * だけの関数とする(test側でlegacyの計算と意味が一致することを検証する)。
 */
export function computeCanonicalQuestionStatus(
  observations: AiMeasurementObservation[]
): QuestionOutcomeStatus {
  if (observations.length === 0) {
    return "insufficient_data";
  }

  const mentionedCount = observations.filter((o) => o.mentioned).length;
  const bestRank = Math.min(
    ...observations.map((o) => o.recommendationRank ?? Infinity)
  );

  if (mentionedCount === 0) return "lose";
  if (mentionedCount === observations.length && bestRank <= 1) return "win";
  return "close";
}
