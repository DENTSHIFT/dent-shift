import type { CriterionScore, DomainKey } from "@/domain/diagnosis/types";
import type { AiObservationResult } from "@/server/providers/ai/types";
import type { AiMeasurementObservation } from "@/domain/ai-measurement/types";

export interface ScoreCriterionInput {
  clinicName: string;
  clinicUrl: string;
  gbpUrl?: string;
  bookingUrl?: string;
  // AIO領域はAI観測結果(mock/実測いずれも将来対応)を根拠として使う
  aiObservations: AiObservationResult[];
  // 2026-09-29修正(PO指示): AIOスコアリングをcanonical AI計測(実OpenAI観測)へ接続する。
  // 指定時(aiMeasurementProviderがrunFreeDiagnosisへ渡された場合)のみ非undefinedになる。
  // 未指定時はlegacyのaiObservationsのみでAIOを算出する(既存挙動を維持)。
  aiMeasurementObservations?: AiMeasurementObservation[];
}

/**
 * 1領域分のcriterion結果を返すプロバイダーインターフェース。
 * 「取得データ → 判定ルール → criterion score」の変換はすべてこの層の実装が担う。
 * P0はMockScoreProviderのみ。実データ連携(GBP/Search Console/GA4等)を追加する場合も、
 * この同じインターフェースの別実装として追加し、domain層(scoring.ts)やサービス層は変更しない。
 */
export interface ScoreProvider {
  readonly name: string;
  score(domain: DomainKey, input: ScoreCriterionInput): Promise<CriterionScore[]>;
}
