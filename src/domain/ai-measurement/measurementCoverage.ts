import type { AiMeasurementObservation, AiMeasurementStatus } from "./types";
import type { MeasurementPlanQuestionEntry } from "./measurementPlan";

/**
 * 質問単位のmeasurement coverage(2026-09-07のユーザー指示: measurement plan仕様
 * 確定ラウンドの続き)。
 *
 * 重要: このファイルも現時点でPatientQuestionResult / runFreeDiagnosis /
 * diagnosisRepository / route.tsのいずれにも接続されていない、独立したdomain
 * モジュールである(接続はユーザーの明示的な指示があるまで行わない)。
 */
export interface MeasurementCoverage {
  totalProviders: number;
  measuredProviders: number;
  referenceProviders: number;
  unavailableProviders: number;
  isPartial: boolean;
}

/**
 * plan(何を計測対象とする予定だったか)と実際のobservations(何が実際に得られたか)
 * が食い違っている場合に投げるエラー。2026-09-07のユーザー指示: 「未実行を実行済み
 * (unavailable)に見せかけない」「どちらかを勝手に採用しない」「別questionの混入を
 * silent ignoreしない」という3つの不整合すべてをこのエラーで表現する
 * (AiMeasurementInvariantViolationError / LegacyLiveAiObservationErrorと同じ、
 * 「値を黙って補正せず明示的にエラーにする」というこのプロジェクト一貫の方針)。
 */
export class MeasurementPlanExecutionMismatchError extends Error {}

/**
 * 1質問分のmeasurement coverageを算出する純粋関数。DB/ネットワーク等の副作用は
 * 一切持たない。呼び出し契約: observationsは「1質問分」に既にgroup済みのものを
 * 渡す(attributeQuestionLoss(observations)と同じ契約)。ただし、誤って別questionの
 * observationが混入した場合はsilent ignoreせず、明示的にエラーにする(下記1)。
 *
 * 算出ルール(2026-09-07のユーザー指示で確定):
 * - totalProviders = planEntry.targetProviders.length
 * - measuredProviders/referenceProviders/unavailableProviders は、
 *   plan対象providerのobservationのmeasurementStatusから集計する
 *   (planEntry.targetProvidersに含まれないproviderのobservationは、
 *   分母にも分子にも一切含めない)。
 * - isPartial = measuredProviders < totalProviders
 *
 * 不整合の扱い(いずれも黙って補正せず、MeasurementPlanExecutionMismatchErrorをthrowする):
 * 1. observations内に obs.question !== planEntry.question の要素が1件でもある
 *    (別questionの混入。silent ignoreしない)
 * 2. plan対象providerに対応するobservationが0件
 *    (「未実行」を"unavailable"(=試行したが失敗)へ推測変換しない)
 * 3. 同一question・同一providerIdのobservationが2件以上
 *    (どちらを正とするか勝手に選ばない)
 *
 * targetProviders=[](未計測の質問)は正当な状態として許可し、
 * { totalProviders: 0, measuredProviders: 0, referenceProviders: 0,
 *   unavailableProviders: 0, isPartial: false } を返す(observationsが存在していても
 *   plan対象外なのでcoverageには含めない。ただし1の構造的不整合チェックは維持する)。
 */
export function computeMeasurementCoverage(
  planEntry: MeasurementPlanQuestionEntry,
  observations: AiMeasurementObservation[]
): MeasurementCoverage {
  for (const obs of observations) {
    if (obs.question !== planEntry.question) {
      throw new MeasurementPlanExecutionMismatchError(
        `observation.question ('${obs.question}') does not match planEntry.question ('${planEntry.question}')`
      );
    }
  }

  let measuredProviders = 0;
  let referenceProviders = 0;
  let unavailableProviders = 0;

  for (const providerId of planEntry.targetProviders) {
    const matches = observations.filter((obs) => obs.providerId === providerId);

    if (matches.length === 0) {
      throw new MeasurementPlanExecutionMismatchError(
        `question '${planEntry.question}': planned provider '${providerId}' has no observation`
      );
    }
    if (matches.length > 1) {
      throw new MeasurementPlanExecutionMismatchError(
        `question '${planEntry.question}': planned provider '${providerId}' has ${matches.length} observations (expected exactly 1)`
      );
    }

    const status: AiMeasurementStatus = matches[0]!.measurementStatus;
    if (status === "measured") {
      measuredProviders++;
    } else if (status === "reference") {
      referenceProviders++;
    } else {
      unavailableProviders++;
    }
  }

  const totalProviders = planEntry.targetProviders.length;
  return {
    totalProviders,
    measuredProviders,
    referenceProviders,
    unavailableProviders,
    isPartial: measuredProviders < totalProviders,
  };
}
