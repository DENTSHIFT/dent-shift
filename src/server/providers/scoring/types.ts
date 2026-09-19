import type { CriterionScore, DomainKey } from "@/domain/diagnosis/types";
import type { AiObservationResult } from "@/server/providers/ai/types";

export interface ScoreCriterionInput {
  clinicName: string;
  clinicUrl: string;
  gbpUrl?: string;
  bookingUrl?: string;
  // AIO領域はAI観測結果(mock/実測いずれも将来対応)を根拠として使う
  aiObservations: AiObservationResult[];
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
