import { describe, expect, it } from "vitest";
import { UnavailableScoreProvider } from "@/server/providers/scoring/unavailableScoreProvider";
import { DOMAIN_ORDER } from "@/domain/diagnosis/scoreCriteria";
import { calculateDomainScore, calculateScoreBreakdown } from "@/domain/diagnosis/scoring";
import { buildTopImprovements } from "@/domain/improvement-task/priorityScoring";
import type { ScoreCriterionInput } from "@/server/providers/scoring/types";
import type { AiObservationResult } from "@/server/providers/ai/types";

/**
 * 2026-09-24: UnavailableScoreProviderの出力を実際の改善TOP3生成パイプライン
 * (scoring.ts → priorityScoring.ts)へ通し、疑似乱数由来の「重大リスク」候補が
 * 二度と生成されないことをend-to-endに近い形で確認する回帰テスト。
 */
function buildAiObservations(): AiObservationResult[] {
  const base = {
    aiProvider: "chatgpt" as const,
    model: "mock-model",
    competitorMentions: [],
    citations: [] as string[],
    region: null,
    dataSource: "mock" as const,
    capturedAt: "2026-01-01T00:00:00.000Z",
  };
  return [
    { ...base, question: "駅から近いおすすめの歯医者は?", mentioned: false, recommendationRank: null, evidence: "e1" },
    {
      ...base,
      aiProvider: "gemini",
      question: "土日も診療している歯科医院は?",
      mentioned: false,
      recommendationRank: null,
      evidence: "e2",
    },
  ];
}

function buildInput(): ScoreCriterionInput {
  return {
    clinicName: "テスト歯科クリニック",
    clinicUrl: "https://example.com",
    // GBP/予約URL未入力(実医院の初回診断でよくあるケース)を想定
    aiObservations: buildAiObservations(),
  };
}

describe("UnavailableScoreProvider → 改善TOP3: 疑似データ由来の重大リスクが出ないこと", () => {
  it("改善TOP3には'risk_escalation'(重大リスク)候補が含まれず、'data_gap'候補のみになる", async () => {
    const provider = new UnavailableScoreProvider();
    const input = buildInput();

    const domainScores = await Promise.all(
      DOMAIN_ORDER.map(async (domain) => {
        const criteria = await provider.score(domain, input);
        return calculateDomainScore(domain, criteria);
      })
    );
    const breakdown = calculateScoreBreakdown(domainScores);

    const top3 = buildTopImprovements({ breakdown, questionResults: [] });

    expect(top3.length).toBeGreaterThan(0);
    for (const task of top3) {
      // MockScoreProviderの疑似乱数スコアから発火していた正本45項目カタログ由来の
      // risk_escalation候補は、evidenceRequirementsのcriterionがunavailableのため
      // 二度と発火しない(isEvidenceAvailable()によりcatalogルール自体が評価されない)。
      // 残るのは、①各領域のdata_gap候補、②AIOの実測AI観測に基づくstandard候補のみ。
      expect(task.kind).not.toBe("risk_escalation");
      expect(["data_gap", "standard"]).toContain(task.kind);
      // standard候補が残る場合も、実測根拠のあるAIO由来のみであること(疑似乱数の
      // MEO/SEO/LLMO/WEB_BOOKING/REVIEWSからは発火し得ない)。
      if (task.kind === "standard") {
        expect(task.evidenceDomain).toBe("AIO");
      }
      // 「重大リスク」等、医院に不利益な印象を与える文言を含まない。
      expect(task.title).not.toContain("重大リスク");
    }
  });
});
