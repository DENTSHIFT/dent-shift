import { seededRandom } from "@/lib/prng";
import type { AiObservationInput, AiObservationResult, AiProvider } from "./types";

/**
 * P0用のモックAIプロバイダー。
 * 実際のChatGPT/Gemini APIには一切接続しない。医院名+質問文をシードにした
 * 決定論的な擬似結果を返すことで、UI/フローを崩さずに開発・テストできるようにする。
 * dataSource は必ず "mock" を返す(引き継ぎ書3章-12: サンプルはサンプルと明記)。
 */
export class MockAiProvider implements AiProvider {
  readonly name = "mock-ai-provider";

  async observe(input: AiObservationInput): Promise<AiObservationResult[]> {
    const providers: Array<{ aiProvider: "chatgpt" | "gemini"; model: string }> = [
      { aiProvider: "chatgpt", model: "mock-gpt" },
      { aiProvider: "gemini", model: "mock-gemini" },
    ];

    const results: AiObservationResult[] = [];
    const capturedAt = new Date().toISOString();

    for (const question of input.patientQuestions) {
      for (const provider of providers) {
        const rand = seededRandom(`${input.clinicName}:${question}:${provider.model}`);
        const roll = rand();
        const mentioned = roll > 0.35;
        const recommendationRank = mentioned ? Math.floor(rand() * 3) + 1 : null;

        const mentionedCompetitors = input.competitors
          .filter(() => rand() > 0.5)
          .map((c) => c.name);

        results.push({
          question,
          aiProvider: provider.aiProvider,
          model: provider.model,
          mentioned,
          recommendationRank,
          competitorMentions: mentionedCompetitors,
          evidence: mentioned
            ? `[mock] "${question}" への回答で ${input.clinicName} が言及されました(順位目安: ${recommendationRank})`
            : `[mock] "${question}" への回答で ${input.clinicName} の言及は確認できませんでした`,
          // 実際の引用取得・商圏/エリア収集の仕組みがP0にはまだ存在しないため、
          // 架空の値で埋めず常に空配列/nullを返す(2026-09-05のユーザー指示)。
          citations: [],
          region: null,
          dataSource: "mock",
          capturedAt,
        });
      }
    }

    return results;
  }
}
