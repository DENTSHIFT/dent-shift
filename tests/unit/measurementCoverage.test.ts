import { describe, expect, it } from "vitest";
import {
  MeasurementPlanExecutionMismatchError,
  computeMeasurementCoverage,
} from "@/domain/ai-measurement/measurementCoverage";
import type { MeasurementPlanQuestionEntry } from "@/domain/ai-measurement/measurementPlan";
import { validateMeasurementPlan } from "@/domain/ai-measurement/measurementPlan";
import { MeasurementPlanSanityError } from "@/domain/ai-measurement/measurementPlan";
import type {
  AiMeasurementObservation,
  AiMeasurementStatus,
  AiObservationFieldProvenance,
  AiProviderId,
} from "@/domain/ai-measurement/types";

/**
 * computeMeasurementCoverage()のunit test(2026-09-07のユーザー指示、measurement plan
 * 仕様確定ラウンド)。DB/ネットワークには一切触れない純粋なテスト。
 */

const QUESTION = "駅から近いおすすめの歯医者は?";

function fieldProvenanceFor(status: AiMeasurementStatus): AiObservationFieldProvenance {
  if (status === "unavailable") {
    const cell = { measurementStatus: "unavailable" as const, derivation: null };
    return { mentioned: cell, recommendationRank: cell, citations: cell, competitorMentions: cell };
  }
  const cell = { measurementStatus: status, derivation: "derived" as const };
  return { mentioned: cell, recommendationRank: cell, citations: cell, competitorMentions: cell };
}

function buildObservation(params: {
  providerId: AiProviderId;
  measurementStatus: AiMeasurementStatus;
  question?: string;
}): AiMeasurementObservation {
  const { providerId, measurementStatus, question = QUESTION } = params;
  const isUnavailable = measurementStatus === "unavailable";
  return {
    question,
    providerId,
    model: `${providerId}-fixture-model`,
    sourceType: "ai_provider",
    measurementStatus,
    mentioned: isUnavailable ? null : true,
    recommendationRank: isUnavailable ? null : 1,
    citations: isUnavailable ? null : [],
    competitorMentions: isUnavailable ? null : [],
    region: null,
    evidence: `test evidence (${providerId}/${measurementStatus})`,
    unavailableReason: isUnavailable ? "temporarily_unavailable" : null,
    provisional: measurementStatus === "reference",
    measurementMeta: {
      schemaVersion: "ai_observation_measurement_meta_v1",
      toolType: "web_search",
      searchExecuted: measurementStatus === "measured",
      searchQueries: [],
      measurementLogicVersion: "test-logic-v1",
      promptVersion: "test-prompt-v1",
      providerResponseId: isUnavailable ? null : `resp_${providerId}`,
      providerReportedModelId: isUnavailable ? null : `${providerId}-fixture-model`,
      usage: null,
      fieldProvenance: fieldProvenanceFor(measurementStatus),
    },
    capturedAt: "2026-01-01T00:00:00.000Z",
  };
}

function planEntry(targetProviders: AiProviderId[]): MeasurementPlanQuestionEntry {
  return { question: QUESTION, targetProviders };
}

describe("computeMeasurementCoverage: 正常系", () => {
  it("CASE1: OpenAIのみmeasured → 1/1/0/0, isPartial=false", () => {
    const coverage = computeMeasurementCoverage(planEntry(["openai"]), [
      buildObservation({ providerId: "openai", measurementStatus: "measured" }),
    ]);
    expect(coverage).toEqual({
      totalProviders: 1,
      measuredProviders: 1,
      referenceProviders: 0,
      unavailableProviders: 0,
      isPartial: false,
    });
  });

  it("CASE2: OpenAI measured + Gemini unavailable → total=2, measured=1, unavailable=1, isPartial=true", () => {
    const coverage = computeMeasurementCoverage(planEntry(["openai", "gemini"]), [
      buildObservation({ providerId: "openai", measurementStatus: "measured" }),
      buildObservation({ providerId: "gemini", measurementStatus: "unavailable" }),
    ]);
    expect(coverage).toEqual({
      totalProviders: 2,
      measuredProviders: 1,
      referenceProviders: 0,
      unavailableProviders: 1,
      isPartial: true,
    });
  });

  it("CASE3: OpenAI + Gemini 両方measured → isPartial=false", () => {
    const coverage = computeMeasurementCoverage(planEntry(["openai", "gemini"]), [
      buildObservation({ providerId: "openai", measurementStatus: "measured" }),
      buildObservation({ providerId: "gemini", measurementStatus: "measured" }),
    ]);
    expect(coverage.totalProviders).toBe(2);
    expect(coverage.measuredProviders).toBe(2);
    expect(coverage.isPartial).toBe(false);
  });

  it("CASE4: OpenAI + Gemini 両方reference → measured=0, reference=2, isPartial=true", () => {
    const coverage = computeMeasurementCoverage(planEntry(["openai", "gemini"]), [
      buildObservation({ providerId: "openai", measurementStatus: "reference" }),
      buildObservation({ providerId: "gemini", measurementStatus: "reference" }),
    ]);
    expect(coverage).toEqual({
      totalProviders: 2,
      measuredProviders: 0,
      referenceProviders: 2,
      unavailableProviders: 0,
      isPartial: true,
    });
  });

  it("CASE5: targetProviders=[] → all 0 / isPartial=false", () => {
    const coverage = computeMeasurementCoverage(planEntry([]), []);
    expect(coverage).toEqual({
      totalProviders: 0,
      measuredProviders: 0,
      referenceProviders: 0,
      unavailableProviders: 0,
      isPartial: false,
    });
  });

  it("CASE6: plan対象外のprovider observationはcoverageへ含めない", () => {
    const coverage = computeMeasurementCoverage(planEntry(["openai"]), [
      buildObservation({ providerId: "openai", measurementStatus: "measured" }),
      // geminiはplan対象外(targetProvidersに含まれない)。存在していても分母・分子に影響しない。
      buildObservation({ providerId: "gemini", measurementStatus: "measured" }),
    ]);
    expect(coverage).toEqual({
      totalProviders: 1,
      measuredProviders: 1,
      referenceProviders: 0,
      unavailableProviders: 0,
      isPartial: false,
    });
  });
});

describe("computeMeasurementCoverage: 異常系(MeasurementPlanExecutionMismatchError)", () => {
  it("CASE7: plan対象providerに対応するobservationが0件ならエラー(unavailableへ推測変換しない)", () => {
    expect(() => computeMeasurementCoverage(planEntry(["openai"]), [])).toThrow(
      MeasurementPlanExecutionMismatchError
    );
  });

  it("CASE8: 同一question・同一providerIdのobservationが2件以上ならエラー", () => {
    expect(() =>
      computeMeasurementCoverage(planEntry(["openai"]), [
        buildObservation({ providerId: "openai", measurementStatus: "measured" }),
        buildObservation({ providerId: "openai", measurementStatus: "reference" }),
      ])
    ).toThrow(MeasurementPlanExecutionMismatchError);
  });

  it("CASE9: 別questionのobservationが混入していればエラー(silent ignoreしない)", () => {
    expect(() =>
      computeMeasurementCoverage(planEntry(["openai"]), [
        buildObservation({ providerId: "openai", measurementStatus: "measured" }),
        buildObservation({
          providerId: "openai",
          measurementStatus: "measured",
          question: "別の質問文",
        }),
      ])
    ).toThrow(MeasurementPlanExecutionMismatchError);
  });

  it("CASE9b: targetProviders=[]でも別questionの混入チェックは維持される", () => {
    expect(() =>
      computeMeasurementCoverage(planEntry([]), [
        buildObservation({
          providerId: "openai",
          measurementStatus: "measured",
          question: "別の質問文",
        }),
      ])
    ).toThrow(MeasurementPlanExecutionMismatchError);
  });
});

describe("CASE10: MeasurementPlanのsanity test(targetProviders重複)", () => {
  it("同一質問内でtargetProvidersが重複したplanはvalidateMeasurementPlan()でエラーになる", () => {
    expect(() =>
      validateMeasurementPlan({
        planVersion: "test-plan@2026-01-01.1",
        questions: [{ question: QUESTION, targetProviders: ["openai", "openai"] }],
      })
    ).toThrow(MeasurementPlanSanityError);
  });
});
