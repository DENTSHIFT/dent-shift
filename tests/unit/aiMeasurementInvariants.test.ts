import { describe, expect, it } from "vitest";
import {
  AiMeasurementInvariantViolationError,
  validateAiMeasurementObservation,
} from "@/domain/ai-measurement/invariants";
import type {
  AiMeasurementObservation,
  AiObservationFieldProvenance,
} from "@/domain/ai-measurement/types";

/**
 * AiMeasurementObservationのdomain invariant(2026-09-07のユーザー指示、最低限のもの)の
 * unit test。DB/ネットワークには一切触れない純粋なテスト。
 */

function measuredFieldProvenance(): AiObservationFieldProvenance {
  return {
    mentioned: { measurementStatus: "measured", derivation: "derived" },
    recommendationRank: { measurementStatus: "measured", derivation: "estimated" },
    citations: { measurementStatus: "measured", derivation: "direct" },
    competitorMentions: { measurementStatus: "measured", derivation: "derived" },
  };
}

function unavailableFieldProvenance(): AiObservationFieldProvenance {
  const cell = { measurementStatus: "unavailable" as const, derivation: null };
  return {
    mentioned: cell,
    recommendationRank: cell,
    citations: cell,
    competitorMentions: cell,
  };
}

function baseMeasuredObservation(): AiMeasurementObservation {
  return {
    question: "駅から近いおすすめの歯医者は?",
    providerId: "openai",
    model: "gpt-search-fixture-model",
    sourceType: "ai_provider",
    measurementStatus: "measured",
    mentioned: true,
    recommendationRank: 1,
    citations: ["https://sakura-dental-clinic.example.com/"],
    competitorMentions: ["あおぞら歯科"],
    region: null,
    evidence: "test evidence",
    unavailableReason: null,
    provisional: false,
    measurementMeta: {
      schemaVersion: "ai_observation_measurement_meta_v1",
      toolType: "web_search",
      searchExecuted: true,
      searchQueries: ["駅前 歯科"],
      measurementLogicVersion: "openai_responses_web_search_v1",
      promptVersion: "openai_patient_question_prompt_v1",
      providerResponseId: "resp_1",
      providerReportedModelId: "gpt-search-fixture-model",
      usage: { inputTokens: 100, outputTokens: 50, toolCallCount: 1 },
      fieldProvenance: measuredFieldProvenance(),
    },
    capturedAt: "2026-01-01T00:00:00.000Z",
  };
}

function baseMockObservation(): AiMeasurementObservation {
  return {
    question: "駅から近いおすすめの歯医者は?",
    providerId: "openai",
    model: "mock-model",
    sourceType: "mock",
    measurementStatus: "reference",
    mentioned: true,
    recommendationRank: 1,
    citations: [],
    competitorMentions: [],
    region: null,
    evidence: "[mock] test evidence",
    unavailableReason: null,
    provisional: true,
    measurementMeta: null,
    capturedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("validateAiMeasurementObservation: 正常系", () => {
  it("sourceType='ai_provider'・measurementStatus='measured'の正常な観測は例外を投げない", () => {
    expect(() => validateAiMeasurementObservation(baseMeasuredObservation())).not.toThrow();
  });

  it("sourceType='mock'(measurementMeta=null)の観測は例外を投げない(既存mock診断との後方互換)", () => {
    expect(() => validateAiMeasurementObservation(baseMockObservation())).not.toThrow();
  });

  it("measurementStatus='unavailable'ですべてのフィールドがnullな観測は例外を投げない", () => {
    const obs: AiMeasurementObservation = {
      ...baseMeasuredObservation(),
      measurementStatus: "unavailable",
      mentioned: null,
      recommendationRank: null,
      citations: null,
      competitorMentions: null,
      unavailableReason: "temporarily_unavailable",
      measurementMeta: {
        ...baseMeasuredObservation().measurementMeta!,
        searchExecuted: false,
        searchQueries: [],
        fieldProvenance: unavailableFieldProvenance(),
      },
    };
    expect(() => validateAiMeasurementObservation(obs)).not.toThrow();
  });
});

describe("validateAiMeasurementObservation: 異常系", () => {
  it("measurementStatus='unavailable'なのにunavailableReason=nullならエラー", () => {
    const obs: AiMeasurementObservation = {
      ...baseMeasuredObservation(),
      measurementStatus: "unavailable",
      mentioned: null,
      recommendationRank: null,
      citations: null,
      competitorMentions: null,
      unavailableReason: null,
      measurementMeta: {
        ...baseMeasuredObservation().measurementMeta!,
        fieldProvenance: unavailableFieldProvenance(),
      },
    };
    expect(() => validateAiMeasurementObservation(obs)).toThrow(
      AiMeasurementInvariantViolationError
    );
  });

  it("measurementStatus='unavailable'なのにmentionedが非nullならエラー", () => {
    const obs: AiMeasurementObservation = {
      ...baseMeasuredObservation(),
      measurementStatus: "unavailable",
      recommendationRank: null,
      citations: null,
      competitorMentions: null,
      unavailableReason: "temporarily_unavailable",
      measurementMeta: {
        ...baseMeasuredObservation().measurementMeta!,
        fieldProvenance: unavailableFieldProvenance(),
      },
    };
    expect(() => validateAiMeasurementObservation(obs)).toThrow(
      AiMeasurementInvariantViolationError
    );
  });

  it("measurementStatus!=='unavailable'なのにunavailableReasonが非nullならエラー", () => {
    const obs: AiMeasurementObservation = {
      ...baseMeasuredObservation(),
      unavailableReason: "temporarily_unavailable",
    };
    expect(() => validateAiMeasurementObservation(obs)).toThrow(
      AiMeasurementInvariantViolationError
    );
  });

  it("sourceType='ai_provider'なのにmeasurementMeta=nullならエラー", () => {
    const obs: AiMeasurementObservation = {
      ...baseMeasuredObservation(),
      measurementMeta: null,
    };
    expect(() => validateAiMeasurementObservation(obs)).toThrow(
      AiMeasurementInvariantViolationError
    );
  });

  it("fieldのmeasurementStatus='unavailable'なのにderivationが非nullならエラー", () => {
    const obs = baseMeasuredObservation();
    obs.measurementMeta!.fieldProvenance.recommendationRank = {
      measurementStatus: "unavailable",
      derivation: "estimated",
    };
    expect(() => validateAiMeasurementObservation(obs)).toThrow(
      AiMeasurementInvariantViolationError
    );
  });

  it("fieldのmeasurementStatus!=='unavailable'なのにderivation=nullならエラー", () => {
    const obs = baseMeasuredObservation();
    obs.measurementMeta!.fieldProvenance.citations = {
      measurementStatus: "measured",
      derivation: null,
    };
    expect(() => validateAiMeasurementObservation(obs)).toThrow(
      AiMeasurementInvariantViolationError
    );
  });
});
