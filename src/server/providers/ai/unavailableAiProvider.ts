import type { AiObservationResult, AiProvider } from "./types";

/**
 * 2026-09-27(PO承認、Mock除去の第一段階): 通常の無料診断からMockAiProviderを外し、
 * 実測手段(aiMeasurementProvider経由のOpenAI等)が未接続・未設定の場合は、
 * 「観測結果が0件」という正直な状態を返す。
 *
 * MockAiProviderが行っていた「疑似乱数で言及・順位・競合言及を捏造する」ことを一切せず、
 * 常に空配列を返す。呼び出し側(runFreeDiagnosis.ts)は、観測0件を
 * - スコア算出(UnavailableScoreProvider.scoreAioGroundedOnly): 該当criterionをunavailableに
 * - 患者質問別ステータス(buildQuestionResults): "insufficient_data"に
 * - サンプル診断判定(computeIsSample): mock由来ではないため、これだけではisSampleにしない
 * とそれぞれ正しく解釈する(いずれも既存ロジックが「0件」を正しく未測定として扱う設計に
 * なっているため、この関数自体は空配列を返すだけでよい)。
 *
 * MockAiProviderのファイル自体は削除しない(ユニットテスト・開発用fixture・
 * 明示的なデモモード専用として引き続き利用可能)。
 */
export class UnavailableAiProvider implements AiProvider {
  readonly name = "unavailable-ai-provider";

  async observe(): Promise<AiObservationResult[]> {
    return [];
  }
}
