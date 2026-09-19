import { describe, expect, it } from "vitest";
import {
  runFreeDiagnosis,
  mapCanonicalMeasuredForLossAttribution,
  mapLegacyForLossAttribution,
  UnsupportedNonMeasuredCanonicalObservationForLossAttributionError,
  UnsupportedLegacyLiveObservationForLossAttributionError,
} from "@/server/services/runFreeDiagnosis";
import type { RunFreeDiagnosisDeps } from "@/server/services/runFreeDiagnosis";
import { DOMAIN_CRITERIA } from "@/domain/diagnosis/scoreCriteria";
import type { CriterionScore, DomainKey } from "@/domain/diagnosis/types";
import type { AiObservationInput, AiObservationResult, AiProvider } from "@/server/providers/ai/types";
import type { CompetitorProvider } from "@/server/providers/competitor/types";
import type { CompetitorClinic } from "@/domain/competitor/types";
import type { ScoreCriterionInput, ScoreProvider } from "@/server/providers/scoring/types";
import type { AdComplianceCheckInput, AdComplianceProvider } from "@/server/providers/ad-compliance/types";
import type { RawAdRiskFinding } from "@/domain/ad-compliance/types";
import type { AiMeasurementObservation, AiMeasurementStatus } from "@/domain/ai-measurement/types";
import type {
  AiMeasurementObservationInput,
  AiMeasurementProvider,
} from "@/domain/ai-measurement/provider";
import { MEASUREMENT_PLAN } from "@/domain/ai-measurement/measurementPlan";

/**
 * canonical measured loseのroot cause本接続(2026-09-08のユーザー指示)のbridge test。
 *
 * 対象範囲(2026-09-08承認済み設計、案2):
 * - LossAttributionObservationInputはsourceType:"mock"|"canonical_measurement"ベース
 *   (旧dataSource:"mock"|"live"は退役)
 * - canonical measuredのみがreal root cause attributionの入力になる
 * - reference/unavailableは混ぜない(canonical mapperへ渡すと明示的error)
 * - canonical/legacyは1質問のroot cause内で混在しない(useCanonicalStatusを共有)
 * - canonical measured loseで生成されるrootCauseKeyはAIO:ai_search_presenceのみ
 * - citation_acquisitionは生成しない、competitorMentionsだけから新root causeを作らない
 * - citations/recommendationRankはroot cause判定に使用しない
 * - confidenceはmedium固定、canonical measured由来はprovisional=false
 * - aggregateAioLossRootCausesは無変更で再利用できること
 */

const FIXED_AT = "2026-01-01T00:00:00.000Z";

function fullHealthCriteria(domain: DomainKey): CriterionScore[] {
  return DOMAIN_CRITERIA[domain].map((def) => ({
    key: def.key,
    label: def.label,
    maxScore: def.maxScore,
    score: def.maxScore,
    status: "estimated",
    evidence: [{ summary: "test: healthy" }],
    measuredAt: FIXED_AT,
    dataSource: "mock",
    unavailableReason: null,
  }));
}

class FakeCompetitorProvider implements CompetitorProvider {
  readonly name = "fake-competitor-provider";
  async findNearbyCompetitors(): Promise<CompetitorClinic[]> {
    return [];
  }
}

class FakeAdComplianceProvider implements AdComplianceProvider {
  readonly name = "fake-ad-compliance-provider";
  async check(_input: AdComplianceCheckInput): Promise<RawAdRiskFinding[]> {
    return [];
  }
}

class FakeScoreProvider implements ScoreProvider {
  readonly name = "fake-score-provider";
  async score(domain: DomainKey, _input: ScoreCriterionInput): Promise<CriterionScore[]> {
    return fullHealthCriteria(domain);
  }
}

interface LegacyQuestionSpec {
  mentioned: boolean;
  competitorMentions?: string[];
  evidence?: string;
}

/** 質問ごとにmentioned/competitorMentionsを設定できるlegacy mock provider(dataSourceは常にmock)。 */
class ConfigurableFakeAiProvider implements AiProvider {
  readonly name = "configurable-fake-ai-provider-root-cause";
  constructor(
    private readonly specByQuestion: Partial<Record<string, LegacyQuestionSpec>>,
    private readonly defaultSpec: LegacyQuestionSpec = { mentioned: true }
  ) {}

  async observe(input: AiObservationInput): Promise<AiObservationResult[]> {
    return input.patientQuestions.map((question) => {
      const spec = this.specByQuestion[question] ?? this.defaultSpec;
      return {
        question,
        aiProvider: "chatgpt",
        model: "fake",
        mentioned: spec.mentioned,
        recommendationRank: spec.mentioned ? 1 : null,
        competitorMentions: spec.competitorMentions ?? [],
        citations: [],
        region: null,
        evidence: spec.evidence ?? "test: legacy evidence",
        dataSource: "mock",
        capturedAt: FIXED_AT,
      };
    });
  }
}

interface CanonicalQuestionSpec {
  measurementStatus: AiMeasurementStatus;
  mentioned?: boolean | null;
  competitorMentions?: string[] | null;
  citations?: string[] | null;
}

function fieldProvenanceFor(status: AiMeasurementStatus) {
  if (status === "unavailable") {
    const cell = { measurementStatus: "unavailable" as const, derivation: null };
    return { mentioned: cell, recommendationRank: cell, citations: cell, competitorMentions: cell };
  }
  const cell = { measurementStatus: status, derivation: "derived" as const };
  return { mentioned: cell, recommendationRank: cell, citations: cell, competitorMentions: cell };
}

function buildCanonicalObservation(
  question: string,
  spec: CanonicalQuestionSpec
): AiMeasurementObservation {
  const isUnavailable = spec.measurementStatus === "unavailable";
  const mentioned = isUnavailable ? null : spec.mentioned ?? true;
  return {
    question,
    providerId: "openai",
    model: "fake-canonical-model",
    sourceType: "ai_provider",
    measurementStatus: spec.measurementStatus,
    mentioned,
    recommendationRank: isUnavailable ? null : mentioned ? 1 : null,
    citations: isUnavailable ? null : spec.citations !== undefined ? spec.citations : [],
    competitorMentions: isUnavailable ? null : spec.competitorMentions ?? [],
    region: null,
    evidence: `test: canonical evidence (${spec.measurementStatus})`,
    unavailableReason: isUnavailable ? "temporarily_unavailable" : null,
    provisional: spec.measurementStatus === "reference",
    measurementMeta: {
      schemaVersion: "ai_observation_measurement_meta_v1",
      toolType: "web_search",
      searchExecuted: spec.measurementStatus === "measured",
      searchQueries: [],
      measurementLogicVersion: "test-logic-v1",
      promptVersion: "test-prompt-v1",
      providerResponseId: isUnavailable ? null : "resp_1",
      providerReportedModelId: isUnavailable ? null : "fake-canonical-model",
      usage: null,
      fieldProvenance: fieldProvenanceFor(spec.measurementStatus),
    },
    capturedAt: FIXED_AT,
  };
}

/** MEASUREMENT_PLAN対象質問すべてに観測を返す(未指定分はdefaultSpecで埋める)fake canonical provider。 */
class ConfigurableFakeAiMeasurementProvider implements AiMeasurementProvider {
  readonly name = "configurable-fake-ai-measurement-provider-root-cause";
  constructor(
    private readonly specByQuestion: Partial<Record<string, CanonicalQuestionSpec>>,
    private readonly defaultSpec: CanonicalQuestionSpec = {
      measurementStatus: "measured",
      mentioned: true,
    }
  ) {}

  async observe(input: AiMeasurementObservationInput): Promise<AiMeasurementObservation[]> {
    return TARGETED_QUESTIONS.filter((q) => input.patientQuestions.includes(q)).map((question) =>
      buildCanonicalObservation(question, this.specByQuestion[question] ?? this.defaultSpec)
    );
  }
}

function buildDeps(overrides: Partial<RunFreeDiagnosisDeps> = {}): RunFreeDiagnosisDeps {
  return {
    aiProvider: new ConfigurableFakeAiProvider({}),
    competitorProvider: new FakeCompetitorProvider(),
    scoreProvider: new FakeScoreProvider(),
    adComplianceProvider: new FakeAdComplianceProvider(),
    ...overrides,
  };
}

const INPUT = {
  clinicName: "canonical root cause本接続検証歯科医院",
  clinicUrl: "https://example.com",
  contactEmail: "test@example.com",
  contactPhone: "03-1234-5678",
};

const TARGETED_QUESTIONS = MEASUREMENT_PLAN.questions
  .filter((q) => q.targetProviders.length > 0)
  .map((q) => q.question);
const UNTARGETED_QUESTIONS = MEASUREMENT_PLAN.questions
  .filter((q) => q.targetProviders.length === 0)
  .map((q) => q.question);
const PRIMARY_TARGETED_QUESTION = TARGETED_QUESTIONS[0]!;
const PRIMARY_UNTARGETED_QUESTION = UNTARGETED_QUESTIONS[0]!;

describe("canonical measured loseのroot cause本接続(2026-09-08のユーザー指示)", () => {
  it("1. canonical measured lose → AIO:ai_search_presence / attributed / medium / canonical_measurement / provisional=false", async () => {
    const result = await runFreeDiagnosis(
      INPUT,
      buildDeps({
        aiMeasurementProvider: new ConfigurableFakeAiMeasurementProvider({
          [PRIMARY_TARGETED_QUESTION]: {
            measurementStatus: "measured",
            mentioned: false,
            competitorMentions: ["Canonical Competitor A"],
          },
        }),
      })
    );
    const target = result.questionResults.find((q) => q.question === PRIMARY_TARGETED_QUESTION)!;
    expect(target.status).toBe("lose");
    expect(target.statusSource).toBe("canonical_measurement");
    expect(target.attributionStatus).toBe("attributed");
    expect(target.rootCauseKey).toBe("AIO:ai_search_presence");
    expect(target.confidence).toBe("medium");
    expect(target.sourceType).toBe("canonical_measurement");
    expect(target.provisional).toBe(false);
    expect(target.competitorDifference).toEqual(["Canonical Competitor A"]);
  });

  it("2. legacy mock lose → 従来結果不変・sourceType=mock・provisional=true", async () => {
    const result = await runFreeDiagnosis(
      INPUT,
      buildDeps({
        aiProvider: new ConfigurableFakeAiProvider({
          [PRIMARY_UNTARGETED_QUESTION]: {
            mentioned: false,
            competitorMentions: ["Legacy Competitor B"],
          },
        }),
      })
    );
    const target = result.questionResults.find((q) => q.question === PRIMARY_UNTARGETED_QUESTION)!;
    expect(target.status).toBe("lose");
    expect(target.statusSource).toBe("legacy_reference");
    expect(target.attributionStatus).toBe("attributed");
    expect(target.rootCauseKey).toBe("AIO:ai_search_presence");
    expect(target.confidence).toBe("medium");
    expect(target.sourceType).toBe("mock");
    expect(target.provisional).toBe(true);
    expect(target.competitorDifference).toEqual(["Legacy Competitor B"]);
  });

  it("3. 同一診断内でcanonical root cause / legacy root causeが混在可能(質問単位で正しく判定される)", async () => {
    const result = await runFreeDiagnosis(
      INPUT,
      buildDeps({
        aiProvider: new ConfigurableFakeAiProvider({
          [PRIMARY_UNTARGETED_QUESTION]: { mentioned: false, competitorMentions: ["Legacy Competitor"] },
        }),
        aiMeasurementProvider: new ConfigurableFakeAiMeasurementProvider({
          [PRIMARY_TARGETED_QUESTION]: {
            measurementStatus: "measured",
            mentioned: false,
            competitorMentions: ["Canonical Competitor"],
          },
        }),
      })
    );
    const canonicalTarget = result.questionResults.find((q) => q.question === PRIMARY_TARGETED_QUESTION)!;
    const legacyTarget = result.questionResults.find((q) => q.question === PRIMARY_UNTARGETED_QUESTION)!;
    expect(canonicalTarget.sourceType).toBe("canonical_measurement");
    expect(canonicalTarget.provisional).toBe(false);
    expect(legacyTarget.sourceType).toBe("mock");
    expect(legacyTarget.provisional).toBe(true);

    // 10. aggregateAioLossRootCausesは無変更のまま、同一rootCauseKeyへ正しく集約され、
    // mockを1件でも含めばisProvisional=trueになる(既存ロジックの再利用確認)。
    const summary = result.aioLossRootCauses.find((s) => s.rootCauseKey === "AIO:ai_search_presence");
    expect(summary).toBeDefined();
    expect(summary!.linkedQuestions).toEqual(
      expect.arrayContaining([PRIMARY_TARGETED_QUESTION, PRIMARY_UNTARGETED_QUESTION])
    );
    expect(summary!.isProvisional).toBe(true);
  });

  it("4. 同一質問内ではcanonical/legacyが非混在(両方loseの証拠を持っていてもcanonicalのみで判定される)", async () => {
    const result = await runFreeDiagnosis(
      INPUT,
      buildDeps({
        aiProvider: new ConfigurableFakeAiProvider({
          [PRIMARY_TARGETED_QUESTION]: { mentioned: false, competitorMentions: ["LegacyOnly"] },
        }),
        aiMeasurementProvider: new ConfigurableFakeAiMeasurementProvider({
          [PRIMARY_TARGETED_QUESTION]: {
            measurementStatus: "measured",
            mentioned: false,
            competitorMentions: ["CanonicalOnly"],
          },
        }),
      })
    );
    const target = result.questionResults.find((q) => q.question === PRIMARY_TARGETED_QUESTION)!;
    expect(target.status).toBe("lose");
    expect(target.statusSource).toBe("canonical_measurement");
    expect(target.sourceType).toBe("canonical_measurement");
    expect(target.competitorDifference).toEqual(["CanonicalOnly"]);
    expect(target.competitorDifference).not.toContain("LegacyOnly");
    expect(target.evidence.some((e) => e.includes("legacy"))).toBe(false);
    expect(target.evidence.every((e) => e.includes("canonical"))).toBe(true);
  });

  it("5. referenceのみ → insufficient_data → root cause NOT_APPLICABLE", async () => {
    const result = await runFreeDiagnosis(
      INPUT,
      buildDeps({
        aiMeasurementProvider: new ConfigurableFakeAiMeasurementProvider({
          [PRIMARY_TARGETED_QUESTION]: { measurementStatus: "reference" },
        }),
      })
    );
    const target = result.questionResults.find((q) => q.question === PRIMARY_TARGETED_QUESTION)!;
    expect(target.status).toBe("insufficient_data");
    expect(target.attributionStatus).toBe("not_applicable");
    expect(target.rootCauseKey).toBeNull();
    expect(target.sourceType).toBeNull();
    expect(target.provisional).toBe(false);
  });

  it("6. unavailableのみ → insufficient_data → root cause NOT_APPLICABLE", async () => {
    const result = await runFreeDiagnosis(
      INPUT,
      buildDeps({
        aiMeasurementProvider: new ConfigurableFakeAiMeasurementProvider({
          [PRIMARY_TARGETED_QUESTION]: { measurementStatus: "unavailable" },
        }),
      })
    );
    const target = result.questionResults.find((q) => q.question === PRIMARY_TARGETED_QUESTION)!;
    expect(target.status).toBe("insufficient_data");
    expect(target.attributionStatus).toBe("not_applicable");
    expect(target.rootCauseKey).toBeNull();
    expect(target.sourceType).toBeNull();
    expect(target.provisional).toBe(false);
  });

  it("7. mapperへreference/unavailable(canonical)・live(legacy)を渡すと明示的にthrowする", () => {
    const referenceObs = buildCanonicalObservation(PRIMARY_TARGETED_QUESTION, {
      measurementStatus: "reference",
    });
    expect(() => mapCanonicalMeasuredForLossAttribution(referenceObs)).toThrow(
      UnsupportedNonMeasuredCanonicalObservationForLossAttributionError
    );

    const unavailableObs = buildCanonicalObservation(PRIMARY_TARGETED_QUESTION, {
      measurementStatus: "unavailable",
    });
    expect(() => mapCanonicalMeasuredForLossAttribution(unavailableObs)).toThrow(
      UnsupportedNonMeasuredCanonicalObservationForLossAttributionError
    );

    const measuredObs = buildCanonicalObservation(PRIMARY_TARGETED_QUESTION, {
      measurementStatus: "measured",
      mentioned: false,
    });
    expect(() => mapCanonicalMeasuredForLossAttribution(measuredObs)).not.toThrow();

    const legacyLiveObs: AiObservationResult = {
      question: PRIMARY_TARGETED_QUESTION,
      aiProvider: "chatgpt",
      model: "fake",
      mentioned: false,
      recommendationRank: null,
      competitorMentions: [],
      citations: [],
      region: null,
      evidence: "test",
      dataSource: "live",
      capturedAt: FIXED_AT,
    };
    expect(() => mapLegacyForLossAttribution(legacyLiveObs)).toThrow(
      UnsupportedLegacyLiveObservationForLossAttributionError
    );
    expect(() => mapLegacyForLossAttribution({ ...legacyLiveObs, dataSource: "mock" })).not.toThrow();
  });

  it("8. competitorMentions 0件/複数件でrootCauseKey/confidenceが変わらない(canonical経路)", async () => {
    const zero = await runFreeDiagnosis(
      INPUT,
      buildDeps({
        aiMeasurementProvider: new ConfigurableFakeAiMeasurementProvider({
          [PRIMARY_TARGETED_QUESTION]: {
            measurementStatus: "measured",
            mentioned: false,
            competitorMentions: [],
          },
        }),
      })
    );
    const many = await runFreeDiagnosis(
      INPUT,
      buildDeps({
        aiMeasurementProvider: new ConfigurableFakeAiMeasurementProvider({
          [PRIMARY_TARGETED_QUESTION]: {
            measurementStatus: "measured",
            mentioned: false,
            competitorMentions: ["A", "B", "C"],
          },
        }),
      })
    );
    const zeroTarget = zero.questionResults.find((q) => q.question === PRIMARY_TARGETED_QUESTION)!;
    const manyTarget = many.questionResults.find((q) => q.question === PRIMARY_TARGETED_QUESTION)!;
    expect(zeroTarget.rootCauseKey).toBe(manyTarget.rootCauseKey);
    expect(zeroTarget.confidence).toBe(manyTarget.confidence);
    expect(zeroTarget.attributionStatus).toBe(manyTarget.attributionStatus);
    expect(zeroTarget.competitorDifference).toEqual([]);
    expect(manyTarget.competitorDifference).toEqual(["A", "B", "C"]);
  });

  it("9. citations null/[]によってroot cause結果が変わらない(mapperがcitationsを使わないため)", async () => {
    const withNullCitations = await runFreeDiagnosis(
      INPUT,
      buildDeps({
        aiMeasurementProvider: new ConfigurableFakeAiMeasurementProvider({
          [PRIMARY_TARGETED_QUESTION]: {
            measurementStatus: "measured",
            mentioned: false,
            citations: null,
          },
        }),
      })
    );
    const withEmptyCitations = await runFreeDiagnosis(
      INPUT,
      buildDeps({
        aiMeasurementProvider: new ConfigurableFakeAiMeasurementProvider({
          [PRIMARY_TARGETED_QUESTION]: {
            measurementStatus: "measured",
            mentioned: false,
            citations: [],
          },
        }),
      })
    );
    const a = withNullCitations.questionResults.find((q) => q.question === PRIMARY_TARGETED_QUESTION)!;
    const b = withEmptyCitations.questionResults.find((q) => q.question === PRIMARY_TARGETED_QUESTION)!;
    expect(a.status).toBe(b.status);
    expect(a.rootCauseKey).toBe(b.rootCauseKey);
    expect(a.attributionStatus).toBe(b.attributionStatus);
    expect(a.confidence).toBe(b.confidence);
    expect(a.sourceType).toBe(b.sourceType);
    expect(a.provisional).toBe(b.provisional);
    expect(a.competitorDifference).toEqual(b.competitorDifference);
  });
});
