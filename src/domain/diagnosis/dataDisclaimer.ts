import type { AiMeasurementObservation } from "@/domain/ai-measurement/types";

const OUTCOME_DISCLAIMER = "数値は実際の集患成果を保証するものではありません。";

/**
 * 診断全体のデータ注意書きを、canonical AI計測の実際の取得状況とisSampleから生成する。
 * providerを呼んだことと実測値を取得できたことは別なので、measured観測が存在する場合
 * だけ「実測」と表現する。reference/unavailableを実測として扱わない。
 */
export function buildDataDisclaimer(
  isSample: boolean,
  aiMeasurementObservations:
    | readonly Pick<AiMeasurementObservation, "measurementStatus">[]
    | undefined
): string {
  const hasMeasured =
    aiMeasurementObservations?.some((obs) => obs.measurementStatus === "measured") ?? false;
  const hasReference =
    aiMeasurementObservations?.some((obs) => obs.measurementStatus === "reference") ?? false;

  if (hasMeasured && isSample) {
    return `このレポートには実測データと参考データが混在しています。質問ごとの取得状況をご確認ください。${OUTCOME_DISCLAIMER}`;
  }
  if (hasMeasured) {
    return `このレポートには実測データが含まれています。取得条件と質問ごとの取得状況をご確認ください。${OUTCOME_DISCLAIMER}`;
  }
  if (hasReference) {
    return `今回は実測データを取得できず、参考データを表示しています。実測結果として扱わないでください。${OUTCOME_DISCLAIMER}`;
  }
  if (aiMeasurementObservations !== undefined) {
    return `今回は実測データを取得できませんでした。質問ごとの取得状況をご確認ください。${OUTCOME_DISCLAIMER}`;
  }
  if (isSample) {
    return `このレポートは参考データに基づく診断です。実測結果として扱わないでください。${OUTCOME_DISCLAIMER}`;
  }
  return `このレポートには実測データが含まれていません。取得条件をご確認ください。${OUTCOME_DISCLAIMER}`;
}
