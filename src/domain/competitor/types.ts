export interface CompetitorClinic {
  id: string;
  name: string;
  url?: string;
  distanceKm?: number;
}

export type QuestionOutcomeStatus = "win" | "close" | "lose" | "insufficient_data";

export interface PatientQuestionResult {
  question: string;
  status: QuestionOutcomeStatus;
  // 「原因です」と断定しない(引き継ぎ書8.3章)。確度を伴う表現にする
  evidence: string[];
}
