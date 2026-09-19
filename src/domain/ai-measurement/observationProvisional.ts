import type { AiMeasurementSourceType, AiMeasurementStatus } from "./types";

/**
 * 観測単位の`provisional`フラグを決定する純粋関数(2026-09-07のユーザー指示で確定)。
 * Prisma `AiObservation.provisional`列にそのまま対応する既存の意味(「推定・
 * ヒューリスティックな値であるか」)を、canonical measurementStatus/sourceTypeから
 * 一意に導出する。
 *
 * 確定ルール:
 * - sourceType === "mock"                    → true(measurementStatusによらず優先)
 * - measurementStatus === "measured"          → false
 * - measurementStatus === "reference"         → true
 * - measurementStatus === "unavailable"       → false
 *
 * 注意: rank(recommendationRank)自体が常にderivation="estimated"であることは、
 * この観測単位のprovisionalフラグとは独立して`fieldProvenance.recommendationRank`が
 * 表現する(「観測は実測だがrankだけ推定」を observation.provisional=false かつ
 * fieldProvenance.recommendationRank.derivation="estimated" の組み合わせで表現する)。
 * 可用性判定(値が使えるかどうか)は必ずmeasurementStatusを先に見ること。
 */
export function resolveObservationProvisional(
  sourceType: AiMeasurementSourceType,
  measurementStatus: AiMeasurementStatus
): boolean {
  if (sourceType === "mock") {
    return true;
  }
  return measurementStatus === "reference";
}
