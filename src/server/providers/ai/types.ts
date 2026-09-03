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
