import type { CompetitorClinic } from "@/domain/competitor/types";
import type { AiMeasurementObservation } from "./types";

/**
 * canonical AI計測observationを返すproviderのインターフェース(2026-09-07のユーザー指示、
 * 「APIなしのcanonical persistence bridge」)。
 *
 * legacy `AiProvider`(src/server/providers/ai/types.ts)と役割・input shapeは同じだが、
 * 戻り値がlegacyな`AiObservationResult`ではなくcanonicalな`AiMeasurementObservation`になる。
 * legacy `AiProvider`は削除・変更しない(既存mock診断を壊さないという指示に対応)。
 *
 * 重要: 今回はこのinterfaceの定義のみを行う。ネットワークを伴う実装
 * (OpenAiMeasurementProvider等)は今回のスコープ外であり、まだ存在しない
 * (production composition root(src/app/api/diagnosis/route.ts)にも一切接続しない)。
 */
export interface AiMeasurementObservationInput {
  clinicName: string;
  clinicUrl: string;
  patientQuestions: string[];
  competitors: CompetitorClinic[];
}

export interface AiMeasurementProvider {
  readonly name: string;
  observe(input: AiMeasurementObservationInput): Promise<AiMeasurementObservation[]>;
}
