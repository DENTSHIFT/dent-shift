import { describe, expect, it } from "vitest";
import { MockScoreProvider } from "@/server/providers/scoring/mockScoreProvider";
import { DOMAIN_CRITERIA, DOMAIN_ORDER } from "@/domain/diagnosis/scoreCriteria";
import type { ScoreCriterionInput } from "@/server/providers/scoring/types";
import type { AiObservationResult } from "@/server/providers/ai/types";

/**
 * MockScoreProviderの検証観点(完了条件: 「同じ入力なら同じ診断結果になり、各点数がどの根拠から
 * 出たか説明できる」):
 * - 決定論性: 同一入力なら常に同一のscore/evidenceを返す(measuredAtの生成時刻は除く)
 * - unavailable(取得不能)を0点として扱わない(score:null、measuredAt:null)
 * - mockはstatus:"measured"を絶対に名乗らない(実測値扱いしない)
 * - evidenceに開発用mockである旨が明示される
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
      question: "駅から近いおすすめの歯医者は?",
      mentioned: true,
      recommendationRank: 2,
      evidence: "e2",
    },
    { ...base, question: "土日も診療している歯科医院は?", mentioned: false, recommendationRank: null, evidence: "e3" },
    {
      ...base,
      aiProvider: "gemini",
      question: "土日も診療している歯科医院は?",
      mentioned: false,
      recommendationRank: null,
      evidence: "e4",
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

/** measuredAt(実行時刻に依存する値)を除いて比較するための正規化 */
function stripMeasuredAt(criteria: Awaited<ReturnType<MockScoreProvider["score"]>>) {
  return criteria.map(({ measuredAt: _measuredAt, ...rest }) => rest);
}

/** result配列からkey一致のcriterionを取り出す(見つからない場合はテスト自体を失敗させる) */
function getCriterion(result: Awaited<ReturnType<MockScoreProvider["score"]>>, key: string) {
  const found = result.find((c) => c.key === key);
  if (!found) throw new Error(`criterion "${key}" が結果に含まれていません`);
  return found;
}

describe("MockScoreProvider: 決定論性", () => {
  it("同一入力・同一domainなら、2回呼び出しても同じscore/statusを返す(measuredAt以外)", async () => {
    const provider = new MockScoreProvider();
    const input = buildInput({ gbpUrl: "https://maps.example.com/gbp", bookingUrl: "https://example.com/book" });

    for (const domain of DOMAIN_ORDER) {
      const first = await provider.score(domain, input);
      const second = await provider.score(domain, input);
      expect(stripMeasuredAt(second)).toEqual(stripMeasuredAt(first));
    }
  });

  it("クリニック名が異なれば(通常)異なるscoreになりうる(=固定値のハードコードではない)", async () => {
    const provider = new MockScoreProvider();
    const a = await provider.score("REVIEWS", buildInput({ clinicName: "クリニックA" }));
    const b = await provider.score("REVIEWS", buildInput({ clinicName: "クリニックB" }));
    const aScores = a.map((c) => c.score);
    const bScores = b.map((c) => c.score);
    expect(aScores).not.toEqual(bScores);
  });
});

describe("MockScoreProvider: unavailableの扱い", () => {
  it("gbpUrl未入力ならMEOは全criterionがunavailableで、score/measuredAtはnull(0点扱いしない)", async () => {
    const provider = new MockScoreProvider();
    const result = await provider.score("MEO", buildInput());

    expect(result).toHaveLength(DOMAIN_CRITERIA.MEO.length);
    for (const c of result) {
      expect(c.status).toBe("unavailable");
      expect(c.score).toBeNull();
      expect(c.measuredAt).toBeNull();
      expect(c.dataSource).toBe("mock");
      // 必要な入力(GBP URL)自体が提供されていない = "not_provided"
      // (2026-09-06のユーザー指示④ 基本ルール1)
      expect(c.unavailableReason).toBe("not_provided");
    }
  });

  it("bookingUrl未入力ならWEB_BOOKINGは全criterionがunavailable", async () => {
    const provider = new MockScoreProvider();
    const result = await provider.score("WEB_BOOKING", buildInput());
    for (const c of result) {
      expect(c.status).toBe("unavailable");
      expect(c.score).toBeNull();
      expect(c.measuredAt).toBeNull();
      expect(c.unavailableReason).toBe("not_provided");
    }
  });

  it("gbpUrl/bookingUrlが入力されていればMEO/WEB_BOOKINGはunavailableにならず、unavailableReasonも付かない", async () => {
    const provider = new MockScoreProvider();
    const meo = await provider.score(
      "MEO",
      buildInput({ gbpUrl: "https://maps.example.com/gbp" })
    );
    const booking = await provider.score(
      "WEB_BOOKING",
      buildInput({ bookingUrl: "https://example.com/book" })
    );
    for (const c of [...meo, ...booking]) {
      expect(c.status).not.toBe("unavailable");
      expect(c.score).not.toBeNull();
      expect(c.measuredAt).not.toBeNull();
      // 正常に計測(推定)できた結果へunavailableReasonを付けない(基本ルール4)
      expect(c.unavailableReason).toBeNull();
    }
  });
});

describe("MockScoreProvider: mockであることの明示・実測値扱いしないこと", () => {
  it("どのdomainのcriterionもstatusは'measured'を名乗らない(estimatedかunavailableのみ)", async () => {
    const provider = new MockScoreProvider();
    const input = buildInput({ gbpUrl: "https://maps.example.com/gbp", bookingUrl: "https://example.com/book" });
    for (const domain of DOMAIN_ORDER) {
      const result = await provider.score(domain, input);
      for (const c of result) {
        expect(["estimated", "unavailable"]).toContain(c.status);
        expect(c.dataSource).toBe("mock");
      }
    }
  });

  it("estimatedなcriterionのevidenceには開発用mockである旨が明示される", async () => {
    const provider = new MockScoreProvider();
    const result = await provider.score("REVIEWS", buildInput());
    for (const c of result) {
      expect(c.evidence.length).toBeGreaterThan(0);
      expect(c.evidence.some((e) => e.summary.includes("開発用mock"))).toBe(true);
    }
  });

  it("maxScoreは常に正本(DOMAIN_CRITERIA)の配点と一致する", async () => {
    const provider = new MockScoreProvider();
    const input = buildInput({ gbpUrl: "https://maps.example.com/gbp", bookingUrl: "https://example.com/book" });
    for (const domain of DOMAIN_ORDER) {
      const result = await provider.score(domain, input);
      for (const c of result) {
        const def = DOMAIN_CRITERIA[domain].find((d) => d.key === c.key);
        expect(def).toBeDefined();
        expect(c.maxScore).toBe(def!.maxScore);
        expect(c.score).not.toBeNull();
        expect(c.score! >= 0 && c.score! <= c.maxScore).toBe(true);
      }
    }
  });
});

describe("MockScoreProvider: AIO(AI観測結果に基づく算出)", () => {
  it("AI観測結果からai_search_presence/question_domain_coverage/recommendation_rankを決定論的に算出する", async () => {
    const provider = new MockScoreProvider();
    const result = await provider.score("AIO", buildInput());

    // 4件中2件で言及あり → mentionRate=0.5 → round(0.5*10)=5
    expect(getCriterion(result, "ai_search_presence").score).toBe(5);
    // 2質問中1質問(駅から近い〜)でのみ言及 → round((1/2)*4)=2
    expect(getCriterion(result, "question_domain_coverage").score).toBe(2);
    // 言及ありの最上位rankは1 → round(5-(1-1)*1.5)=5
    expect(getCriterion(result, "recommendation_rank").score).toBe(5);

    for (const c of result) {
      expect(c.status).toBe("estimated");
      expect(c.dataSource).toBe("mock");
    }
  });

  it("AI観測結果で1件も言及がなければ、言及依存の項目は0点になる(0点だが理由が明示される)", async () => {
    const provider = new MockScoreProvider();
    const noMention = buildAiObservations().map((o) => ({ ...o, mentioned: false, recommendationRank: null }));
    const result = await provider.score("AIO", buildInput({ aiObservations: noMention }));

    expect(getCriterion(result, "ai_search_presence").score).toBe(0);
    expect(getCriterion(result, "recommendation_rank").score).toBe(0);
    expect(getCriterion(result, "question_domain_coverage").score).toBe(0);
    // 0点は「取得不能」ではなく「言及なしという観測結果に基づく推定」なのでunavailableにはしない
    for (const c of result) {
      expect(c.status).toBe("estimated");
    }
  });
});
