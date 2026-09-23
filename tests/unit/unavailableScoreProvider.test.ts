import { describe, expect, it } from "vitest";
import { UnavailableScoreProvider } from "@/server/providers/scoring/unavailableScoreProvider";
import { DOMAIN_CRITERIA, DOMAIN_ORDER } from "@/domain/diagnosis/scoreCriteria";
import { calculateDomainScore, calculateScoreBreakdown } from "@/domain/diagnosis/scoring";
import type { ScoreCriterionInput } from "@/server/providers/scoring/types";
import type { AiObservationResult } from "@/server/providers/ai/types";

/**
 * 2026-09-24: MockScoreProviderのseededRandomによる疑似乱数スコアを本番から排除する
 * ための回帰テスト。「実測できない領域には具体的な点数を出さない」「unavailable領域は
 * 総合スコアへ加算されない」ことを、実際のdomain層集計ロジック(scoring.ts)を通しても確認する。
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
    { ...base, question: "駅から近いおすすめの歯医者は?", mentioned: true, recommendationRank: 1, evidence: "e1" },
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

function buildInput(overrides: Partial<ScoreCriterionInput> = {}): ScoreCriterionInput {
  return {
    clinicName: "テスト歯科クリニック",
    clinicUrl: "https://example.com",
    aiObservations: buildAiObservations(),
    ...overrides,
  };
}

describe("UnavailableScoreProvider: 疑似乱数を使わないこと", () => {
  it("MEO/SEO/LLMO/WEB_BOOKING/REVIEWSは常にunavailableで、scoreはnull(具体的な点数を出さない)", async () => {
    const provider = new UnavailableScoreProvider();
    for (const domain of ["MEO", "SEO", "LLMO", "WEB_BOOKING", "REVIEWS"] as const) {
      const result = await provider.score(
        domain,
        buildInput({ gbpUrl: "https://maps.example.com/gbp", bookingUrl: "https://example.com/book" })
      );
      expect(result).toHaveLength(DOMAIN_CRITERIA[domain].length);
      for (const c of result) {
        expect(c.status).toBe("unavailable");
        expect(c.score).toBeNull();
        expect(c.measuredAt).toBeNull();
        expect(c.unavailableReason).not.toBeNull();
      }
    }
  });

  it("AIOはai_search_presence/recommendation_rank/question_domain_coverageのみ値を持ち、citation_acquisition/information_accuracyはunavailable", async () => {
    const provider = new UnavailableScoreProvider();
    const result = await provider.score("AIO", buildInput());

    const grounded = ["ai_search_presence", "recommendation_rank", "question_domain_coverage"];
    const ungrounded = ["citation_acquisition", "information_accuracy"];

    for (const key of grounded) {
      const c = result.find((c) => c.key === key)!;
      expect(c.status).toBe("estimated");
      expect(c.score).not.toBeNull();
      expect(c.dataSource).toBe("ai_provider");
    }
    for (const key of ungrounded) {
      const c = result.find((c) => c.key === key)!;
      expect(c.status).toBe("unavailable");
      expect(c.score).toBeNull();
    }
  });

  it("どのdomain・criterionも'measured'を名乗らない(estimated/unavailableのみ)", async () => {
    const provider = new UnavailableScoreProvider();
    const input = buildInput({ gbpUrl: "https://maps.example.com/gbp", bookingUrl: "https://example.com/book" });
    for (const domain of DOMAIN_ORDER) {
      const result = await provider.score(domain, input);
      for (const c of result) {
        expect(["estimated", "unavailable"]).toContain(c.status);
      }
    }
  });
});

describe("UnavailableScoreProvider × scoring.ts: 総合スコアへの反映", () => {
  it("unavailable領域は総合スコアのassessedMaxPoints/totalPointsに加算されない", async () => {
    const provider = new UnavailableScoreProvider();
    const input = buildInput({ gbpUrl: "https://maps.example.com/gbp", bookingUrl: "https://example.com/book" });

    const domainScores = await Promise.all(
      DOMAIN_ORDER.map(async (domain) => {
        const criteria = await provider.score(domain, input);
        return calculateDomainScore(domain, criteria);
      })
    );
    const breakdown = calculateScoreBreakdown(domainScores);

    // AIO以外の5領域はunavailable(assessedMaxPoints=0)。AIOはgrounded 3criterionのみ加算される。
    const aio = domainScores.find((d) => d.domain === "AIO")!;
    const others = domainScores.filter((d) => d.domain !== "AIO");
    for (const d of others) {
      expect(d.status).toBe("unavailable");
      expect(d.assessedMaxPoints).toBe(0);
      expect(d.points).toBe(0);
    }
    expect(aio.status).toBe("partial"); // 5criterion中3criterionのみassessed
    expect(breakdown.assessedMaxPoints).toBe(aio.assessedMaxPoints);
    expect(breakdown.totalPoints).toBe(aio.points);
    // 総合ステータスは"partial"(一部領域のみ実測根拠あり)。疑似乱数由来の"measured"や
    // 全領域が埋まったかのような表示にはならない。
    expect(breakdown.totalStatus).toBe("partial");
  });
});
