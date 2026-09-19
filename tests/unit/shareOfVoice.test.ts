import { describe, expect, it } from "vitest";
import { computeShareOfVoice } from "@/domain/competitor/shareOfVoice";
import type { PatientQuestionResult } from "@/domain/competitor/types";

function questionResult(overrides: Partial<PatientQuestionResult> = {}): PatientQuestionResult {
  return {
    question: "質問A",
    status: "lose",
    evidence: [],
    unavailableReason: null,
    competitorDifference: [],
    rootCauseKey: null,
    rootCauseLabel: null,
    confidence: null,
    sourceType: null,
    provisional: false,
    attributionStatus: "not_applicable",
    analysisVersion: null,
    ...overrides,
  };
}

describe("computeShareOfVoice", () => {
  it("winの割合をパーセントで算出する(closeはwinに数えない)", () => {
    const result = computeShareOfVoice([
      questionResult({ question: "Q1", status: "win" }),
      questionResult({ question: "Q2", status: "win" }),
      questionResult({ question: "Q3", status: "close" }),
      questionResult({ question: "Q4", status: "lose" }),
    ]);
    expect(result).toEqual({
      status: "measured",
      winCount: 2,
      measuredQuestionCount: 4,
      percentage: 50,
    });
  });

  it("insufficient_dataの質問は分母から除外する", () => {
    const result = computeShareOfVoice([
      questionResult({ question: "Q1", status: "win" }),
      questionResult({ question: "Q2", status: "insufficient_data", unavailableReason: "insufficient_data" }),
    ]);
    expect(result.measuredQuestionCount).toBe(1);
    expect(result.percentage).toBe(100);
  });

  it("測定対象の質問が1件もない場合は0%ではなくinsufficient_data扱いにする", () => {
    const result = computeShareOfVoice([
      questionResult({ question: "Q1", status: "insufficient_data", unavailableReason: "insufficient_data" }),
    ]);
    expect(result).toEqual({
      status: "insufficient_data",
      winCount: 0,
      measuredQuestionCount: 0,
      percentage: null,
    });
  });

  it("questionResultsが空配列でもinsufficient_data扱いにする", () => {
    expect(computeShareOfVoice([]).status).toBe("insufficient_data");
  });
});
