import { describe, expect, it } from "vitest";
import { computeCanonicalQuestionStatus } from "@/domain/ai-measurement/canonicalQuestionStatus";
import type { AiMeasurementObservation } from "@/domain/ai-measurement/types";
import type { AiObservationResult } from "@/server/providers/ai/types";

/**
 * computeCanonicalQuestionStatus()のunit test(2026-09-07のユーザー指示: win/close/lose
 * へのcanonical measurement本接続ラウンド)。
 *
 * 目的: この関数がlegacy計算(runFreeDiagnosis.ts buildQuestionResults()内の
 * mentionedCount/bestRankベースのstatus算出)と完全に同一の意味(win/close/lose/
 * insufficient_data)を返すことを確認する(ユーザー指示: 「既存のwin/close/loseルールを
 * 勝手に再定義しないこと」を検証する)。呼び出し側(runFreeDiagnosis.ts)の責務である
 * 「measuredのみを渡す」というフィルタ自体はこのファイルでは検証しない
 * (runFreeDiagnosisCanonicalStatusBridge.test.tsで検証する)。
 */

const FIXED_AT = "2026-01-01T00:00:00.000Z";

function measuredObservation(
  overrides: Partial<Pick<AiMeasurementObservation, "mentioned" | "recommendationRank">> = {}
): AiMeasurementObservation {
  return {
    question: "test question",
    providerId: "openai",
    model: "fake-canonical-model",
    sourceType: "ai_provider",
    measurementStatus: "measured",
    mentioned: overrides.mentioned ?? true,
    recommendationRank:
      overrides.recommendationRank !== undefined ? overrides.recommendationRank : 1,
    citations: [],
    competitorMentions: [],
    region: null,
    evidence: "test: measured",
    unavailableReason: null,
    provisional: false,
    measurementMeta: {
      schemaVersion: "ai_observation_measurement_meta_v1",
      toolType: "web_search",
      searchExecuted: true,
      searchQueries: ["test query"],
      measurementLogicVersion: "test-logic-v1",
      promptVersion: "test-prompt-v1",
      providerResponseId: "resp_1",
      providerReportedModelId: "fake-canonical-model",
      usage: null,
      fieldProvenance: {
        mentioned: { measurementStatus: "measured", derivation: "derived" },
        recommendationRank: { measurementStatus: "measured", derivation: "estimated" },
        citations: { measurementStatus: "measured", derivation: "direct" },
        competitorMentions: { measurementStatus: "measured", derivation: "derived" },
      },
    },
    capturedAt: FIXED_AT,
  };
}

/** legacy AiObservationResult。既存runFreeDiagnosis.tsの計算ロジックをそのまま再現する
 *  比較用ヘルパー(このファイル内でのみ使用。production側のロジックは一切importしない
 *  ―― buildQuestionResults()内は非公開関数であるため、ここではロジックの"意味"を
 *  独立に再実装し、computeCanonicalQuestionStatus()の結果と突き合わせる)。 */
function legacyStatus(observations: AiObservationResult[]): "win" | "close" | "lose" | "insufficient_data" {
  if (observations.length === 0) return "insufficient_data";
  const mentionedCount = observations.filter((o) => o.mentioned).length;
  const bestRank = Math.min(...observations.map((o) => o.recommendationRank ?? Infinity));
  if (mentionedCount === 0) return "lose";
  if (mentionedCount === observations.length && bestRank <= 1) return "win";
  return "close";
}

function legacyObservation(mentioned: boolean, recommendationRank: number | null): AiObservationResult {
  return {
    question: "test question",
    aiProvider: "chatgpt",
    model: "fake",
    mentioned,
    recommendationRank,
    competitorMentions: [],
    citations: [],
    region: null,
    evidence: "test",
    dataSource: "mock",
    capturedAt: FIXED_AT,
  };
}

describe("computeCanonicalQuestionStatus", () => {
  it("観測0件 → insufficient_data(measuredProviders===0はlegacyへfallbackしない)", () => {
    expect(computeCanonicalQuestionStatus([])).toBe("insufficient_data");
  });

  it("mentioned=true, rank=1(単一観測) → win", () => {
    const result = computeCanonicalQuestionStatus([
      measuredObservation({ mentioned: true, recommendationRank: 1 }),
    ]);
    expect(result).toBe("win");
  });

  it("mentioned=false(単一観測) → lose", () => {
    const result = computeCanonicalQuestionStatus([
      measuredObservation({ mentioned: false, recommendationRank: null }),
    ]);
    expect(result).toBe("lose");
  });

  it("mentioned=true だが rank=2(単一観測) → close(mentionedCount===lengthだがbestRank>1)", () => {
    const result = computeCanonicalQuestionStatus([
      measuredObservation({ mentioned: true, recommendationRank: 2 }),
    ]);
    expect(result).toBe("close");
  });

  it("複数観測: 一部のみmentioned → close(mentionedCount!==0 かつ !==length)", () => {
    const result = computeCanonicalQuestionStatus([
      measuredObservation({ mentioned: true, recommendationRank: 1 }),
      measuredObservation({ mentioned: false, recommendationRank: null }),
    ]);
    expect(result).toBe("close");
  });

  it("複数観測: 全てmentioned かつ bestRank<=1 → win", () => {
    const result = computeCanonicalQuestionStatus([
      measuredObservation({ mentioned: true, recommendationRank: 2 }),
      measuredObservation({ mentioned: true, recommendationRank: 1 }),
    ]);
    expect(result).toBe("win");
  });

  it("複数観測: 全てmentioned=false → lose", () => {
    const result = computeCanonicalQuestionStatus([
      measuredObservation({ mentioned: false, recommendationRank: null }),
      measuredObservation({ mentioned: false, recommendationRank: null }),
    ]);
    expect(result).toBe("lose");
  });

  describe("legacy計算との意味の一致(既存win/close/loseルールを再定義していないことの検証)", () => {
    const scenarios: Array<{
      label: string;
      mentioned: boolean;
      recommendationRank: number | null;
    }> = [
      { label: "mentioned=true/rank=1", mentioned: true, recommendationRank: 1 },
      { label: "mentioned=true/rank=2", mentioned: true, recommendationRank: 2 },
      { label: "mentioned=true/rank=null", mentioned: true, recommendationRank: null },
      { label: "mentioned=false/rank=null", mentioned: false, recommendationRank: null },
    ];

    for (const scenario of scenarios) {
      it(`単一観測(${scenario.label}): canonicalとlegacyのstatusが一致する`, () => {
        const canonicalResult = computeCanonicalQuestionStatus([
          measuredObservation({
            mentioned: scenario.mentioned,
            recommendationRank: scenario.recommendationRank,
          }),
        ]);
        const legacyResult = legacyStatus([
          legacyObservation(scenario.mentioned, scenario.recommendationRank),
        ]);
        expect(canonicalResult).toBe(legacyResult);
      });
    }

    it("複数観測(混在): canonicalとlegacyのstatusが一致する", () => {
      const canonicalResult = computeCanonicalQuestionStatus([
        measuredObservation({ mentioned: true, recommendationRank: 3 }),
        measuredObservation({ mentioned: false, recommendationRank: null }),
        measuredObservation({ mentioned: true, recommendationRank: 1 }),
      ]);
      const legacyResult = legacyStatus([
        legacyObservation(true, 3),
        legacyObservation(false, null),
        legacyObservation(true, 1),
      ]);
      expect(canonicalResult).toBe(legacyResult);
    });

    it("観測0件: canonicalとlegacyのstatusが一致する(どちらもinsufficient_data)", () => {
      expect(computeCanonicalQuestionStatus([])).toBe(legacyStatus([]));
    });
  });
});

