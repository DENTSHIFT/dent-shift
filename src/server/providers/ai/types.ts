import type { CompetitorClinic } from "@/domain/competitor/types";

export interface AiObservationInput {
  clinicName: string;
  clinicUrl: string;
  patientQuestions: string[];
  competitors: CompetitorClinic[];
}

export interface AiObservationResult {
  question: string;
  aiProvider: "chatgpt" | "gemini";
  model: string;
  mentioned: boolean;
  recommendationRank: number | null;
  competitorMentions: string[];
  evidence: string;
  /**
   * 引用元URL等(2026-09-05のユーザー指示: ai_observationsとして永続化する最小項目に含める)。
   * P0のMockAiProviderは実際の引用取得を行わないため常に空配列を返す(架空の引用を作らない)。
   * 実プロバイダー接続時にここへ実際の引用URLを入れる。
   */
  citations: string[];
  /**
   * 計測対象の地域(2026-09-05のユーザー指示)。P0は医院の商圏・エリア情報を収集する
   * 入力項目自体がまだ存在しないため、常にnull(未収集であることを明示。適当な値を
   * 補完しない)。将来、医院プロフィールに商圏・エリア入力が追加された時点で埋める。
   */
  region: string | null;
  // P0はmock providerのみ。実プロバイダーに差し替えてもこのフィールドで判別できるようにする
  dataSource: "mock" | "live";
  capturedAt: string;
}

/**
 * AI観測結果を取得するためのプロバイダーインターフェース。
 * P0はMockAiProviderのみを実装する。ChatGPT/Geminiへの実接続はこのインターフェースの
 * 別実装として後日追加し、サービス層(runFreeDiagnosis)は一切変更しない。
 */
export interface AiProvider {
  readonly name: string;
  observe(input: AiObservationInput): Promise<AiObservationResult[]>;
}
