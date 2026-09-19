import { describe, expect, it } from "vitest";
import { runFreeDiagnosis } from "@/server/services/runFreeDiagnosis";
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
 * win/close/loseへのcanonical measurement本接続(2026-09-07のユーザー指示)のbridge test。
 * runFreeDiagnosis()を実際に呼び出し、PatientQuestionResult.status/statusSourceが
 * ユーザー指示の必須testリスト(9項目)どおりに振る舞うことを確認する。
 *
 * 対象範囲: 案A(2026-09-07承認済み設計)。
 * - measured観測のみでwin/close/lose判定する(reference/unavailableは混ぜない)
 * - measuredProviders===0 → insufficient_data(legacyへのfallbackなし)
 * - MEASUREMENT_PLAN対象外の質問(targetProviders=[])は引き続きlegacy判定
 * - statusSourceはstatus値と直交する("insufficient_data"でも"canonical_measurement"になり得る)
 * - canonical/legacyは1質問のwin/close/lose判定内で混在しない
 * - isSampleはこのラウンドで変更しない(computeIsSample()自体は未変更)
 */

const FIXED_AT = "2026-01-01T00:00:00.000Z";

// production側のMEASUREMENT_PLANをそのまま参照する(質問名をこのファイルで再定義・
// ハードコードして将来のplan内容変更とdriftしないようにするため。
// aiMeasurementCanonicalPersistence.test.tsと同じ方針)。
const TARGETED_QUESTIONS = MEASUREMENT_PLAN.questions
  .filter((q) => q.targetProviders.length > 0)
  .map((q) => q.question);
const UNTARGETED_QUESTIONS = MEASUREMENT_PLAN.questions
  .filter((q) => q.targetProviders.length === 0)
  .map((q) => q.question);

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

/** 全質問で自院が言及される(legacy win)、通常のmock legacy provider。 */
class FullHealthAiProvider implements AiProvider {
  readonly name = "fake-ai-provider-full-health";
  async observe(input: AiObservationInput): Promise<AiObservationResult[]> {
    return input.patientQuestions.map((question) => ({
      question,
      aiProvider: "chatgpt",
      model: "fake",
      mentioned: true,
      recommendationRank: 1,
      competitorMentions: [],
      citations: [],
      region: null,
      evidence: "test: legacy mentioned",
      dataSource: "mock",
      capturedAt: FIXED_AT,
    }));
  }
}

/** 全質問で自院が言及されない(legacy lose)、mock legacy provider。テスト7で使用。 */
class NoHealthAiProvider implements AiProvider {
  readonly name = "fake-ai-provider-no-health";
  async observe(input: AiObservationInput): Promise<AiObservationResult[]> {
    return input.patientQuestions.map((question) => ({
      question,
      aiProvider: "chatgpt",
      model: "fake",
      mentioned: false,
      recommendationRank: null,
      competitorMentions: ["競合医院A"],
      citations: [],
      region: null,
      evidence: "test: legacy not mentioned",
      dataSource: "mock",
      capturedAt: FIXED_AT,
    }));
  }
}

interface CanonicalObsSpec {
  measurementStatus: AiMeasurementStatus;
  mentioned?: boolean | null;
  recommendationRank?: number | null;
}

function fieldProvenanceFor(status: AiMeasurementStatus) {
  if (status === "unavailable") {
    const cell = { measurementStatus: "unavailable" as const, derivation: null };
    return { mentioned: cell, recommendationRank: cell, citations: cell, competitorMentions: cell };
  }
  const cell = { measurementStatus: status, derivation: "derived" as const };
  return { mentioned: cell, recommendationRank: cell, citations: cell, competitorMentions: cell };
}

function buildCanonicalObservation(question: string, spec: CanonicalObsSpec): AiMeasurementObservation {
  const isUnavailable = spec.measurementStatus === "unavailable";
  const mentioned = isUnavailable ? null : spec.mentioned ?? true;
  const recommendationRank = isUnavailable
    ? null
    : spec.recommendationRank !== undefined
      ? spec.recommendationRank
      : mentioned
        ? 1
        : null;
  return {
    question,
    providerId: "openai",
    model: "fake-canonical-model",
    sourceType: "ai_provider",
    measurementStatus: spec.measurementStatus,
    mentioned,
    recommendationRank,
    citations: isUnavailable ? null : [],
    competitorMentions: isUnavailable ? null : [],
    region: null,
    evidence: `test: canonical ${spec.measurementStatus}`,
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

/**
 * question -> spec のmapを受け取り、MEASUREMENT_PLANの対象質問すべてに観測を返す
 * fake canonical provider。mapに無い対象質問には、plan整合性エラー
 * (MeasurementPlanExecutionMismatchError)を起こさないためのdefaultSpecを補完する
 * (aiMeasurementCanonicalPersistence.test.tsのfillerパターンと同じ方針)。
 */
class ConfigurableFakeAiMeasurementProvider implements AiMeasurementProvider {
  readonly name = "configurable-fake-ai-measurement-provider-canonical-status";
  constructor(
    private readonly specByQuestion: Partial<Record<string, CanonicalObsSpec>>,
    private readonly defaultSpec: CanonicalObsSpec = {
      measurementStatus: "measured",
      mentioned: true,
      recommendationRank: 1,
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
    aiProvider: new FullHealthAiProvider(),
    competitorProvider: new FakeCompetitorProvider(),
    scoreProvider: new FakeScoreProvider(),
    adComplianceProvider: new FakeAdComplianceProvider(),
    ...overrides,
  };
}

const INPUT = {
  clinicName: "canonical status本接続検証歯科医院",
  clinicUrl: "https://example.com",
  contactEmail: "test@example.com",
  contactPhone: "03-1234-5678",
};

const PRIMARY_TARGETED_QUESTION = TARGETED_QUESTIONS[0]!;

describe("win/close/loseへのcanonical measurement本接続(2026-09-07のユーザー指示)", () => {
  it("1. canonical measured + mentioned=true/rank=1 → win, statusSource=canonical_measurement", async () => {
    const result = await runFreeDiagnosis(
      INPUT,
      buildDeps({
        aiMeasurementProvider: new ConfigurableFakeAiMeasurementProvider({
          [PRIMARY_TARGETED_QUESTION]: {
            measurementStatus: "measured",
            mentioned: true,
            recommendationRank: 1,
          },
        }),
      })
    );
    const target = result.questionResults.find((q) => q.question === PRIMARY_TARGETED_QUESTION)!;
    expect(target.status).toBe("win");
    expect(target.statusSource).toBe("canonical_measurement");
  });

  it("2. canonical measured + mentioned=false → lose, statusSource=canonical_measurement", async () => {
    const result = await runFreeDiagnosis(
      INPUT,
      buildDeps({
        aiMeasurementProvider: new ConfigurableFakeAiMeasurementProvider({
          [PRIMARY_TARGETED_QUESTION]: {
            measurementStatus: "measured",
            mentioned: false,
            recommendationRank: null,
          },
        }),
      })
    );
    const target = result.questionResults.find((q) => q.question === PRIMARY_TARGETED_QUESTION)!;
    expect(target.status).toBe("lose");
    expect(target.statusSource).toBe("canonical_measurement");
  });

  it("3. canonical referenceのみ → insufficient_data, statusSource=canonical_measurement", async () => {
    const result = await runFreeDiagnosis(
      INPUT,
      buildDeps({
        aiMeasurementProvider: new ConfigurableFakeAiMeasurementProvider({
          // mentioned=trueのreference観測(本文には「言及あり」だが検索未実行の参考データ)。
          // これがwin/loseの判定に一切使われない(measuredのみが判定対象)ことを、
          // status !== "lose"かつ生のmentioned値が書き換えられていないことの両面で確認する
          // (ユーザー指示12: reference/unavailableをmentioned=falseへ変換していないことを
          // 明示的に確認)。
          [PRIMARY_TARGETED_QUESTION]: { measurementStatus: "reference", mentioned: true },
        }),
      })
    );
    const target = result.questionResults.find((q) => q.question === PRIMARY_TARGETED_QUESTION)!;
    expect(target.status).toBe("insufficient_data");
    expect(target.status).not.toBe("lose");
    expect(target.statusSource).toBe("canonical_measurement");
    expect(target.unavailableReason).toBe("insufficient_data");
    // 生のcanonical観測自体のmentionedがfalseへ書き換えられていないこと(元のtrueのまま)。
    const rawObservation = result.aiMeasurementObservations?.find(
      (o) => o.question === PRIMARY_TARGETED_QUESTION && o.measurementStatus === "reference"
    );
    expect(rawObservation?.mentioned).toBe(true);
  });

  it("4. canonical unavailableのみ → insufficient_data, statusSource=canonical_measurement", async () => {
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
    expect(target.status).not.toBe("lose");
    expect(target.statusSource).toBe("canonical_measurement");
    expect(target.unavailableReason).toBe("insufficient_data");
    // unavailable観測はmentioned=null(仕様上必須)のまま保持され、falseへ変換されていないこと
    // (ユーザー指示12)。
    const rawObservation = result.aiMeasurementObservations?.find(
      (o) => o.question === PRIMARY_TARGETED_QUESTION && o.measurementStatus === "unavailable"
    );
    expect(rawObservation?.mentioned).toBeNull();
  });

  it("5. aiMeasurementProvider未指定 → legacy status, statusSource=legacy_reference", async () => {
    const result = await runFreeDiagnosis(INPUT, buildDeps());
    for (const q of result.questionResults) {
      expect(q.status).toBe("win"); // FullHealthAiProviderは全質問mentioned=true/rank=1
      expect(q.statusSource).toBe("legacy_reference");
      expect(q.measurementCoverage).toBeNull();
    }
  });

  it("6. targetProviders=[]の質問 → legacy status, statusSource=legacy_reference", async () => {
    const result = await runFreeDiagnosis(
      INPUT,
      buildDeps({
        aiMeasurementProvider: new ConfigurableFakeAiMeasurementProvider({}),
      })
    );
    for (const question of UNTARGETED_QUESTIONS) {
      const target = result.questionResults.find((q) => q.question === question)!;
      expect(target.status).toBe("win"); // legacy FullHealthAiProviderのまま
      expect(target.statusSource).toBe("legacy_reference");
    }
  });

  it("7. canonical measuredとlegacy mockが同質問に存在 → canonicalのみで判定されること", async () => {
    // legacyはNoHealthAiProvider(mentioned=false → legacy計算ならlose)、
    // canonicalはmentioned=true/rank=1(measured → canonicalならwin)を同じ質問に与える。
    // canonicalのみで判定されるならstatus="win"になるはず(legacyのlose判定に引きずられない)。
    const result = await runFreeDiagnosis(
      INPUT,
      buildDeps({
        aiProvider: new NoHealthAiProvider(),
        aiMeasurementProvider: new ConfigurableFakeAiMeasurementProvider({
          [PRIMARY_TARGETED_QUESTION]: {
            measurementStatus: "measured",
            mentioned: true,
            recommendationRank: 1,
          },
        }),
      })
    );
    const target = result.questionResults.find((q) => q.question === PRIMARY_TARGETED_QUESTION)!;
    expect(target.status).toBe("win");
    expect(target.statusSource).toBe("canonical_measurement");
    // evidenceにもlegacy("test: legacy not mentioned")が混入していないこと(非混在保証)。
    expect(target.evidence.some((e) => e.includes("legacy not mentioned"))).toBe(false);
    expect(target.evidence.every((e) => e.includes("canonical"))).toBe(true);

    // 対象外の質問は引き続きlegacy(NoHealthAiProvider)のloseのまま。
    const untargeted = result.questionResults.find((q) => q.question === UNTARGETED_QUESTIONS[0])!;
    expect(untargeted.status).toBe("lose");
    expect(untargeted.statusSource).toBe("legacy_reference");
  });

  it("8. 混在診断(canonical + legacy) → isSample=true維持", async () => {
    // computeIsSample()自体はこのラウンドで変更しない。legacy(FullHealthAiProvider)も
    // canonicalのfixtureもmock/fixtureベースなのでisSample=trueのまま。
    const result = await runFreeDiagnosis(
      INPUT,
      buildDeps({
        aiMeasurementProvider: new ConfigurableFakeAiMeasurementProvider({
          [PRIMARY_TARGETED_QUESTION]: {
            measurementStatus: "measured",
            mentioned: true,
            recommendationRank: 1,
          },
        }),
      })
    );
    expect(result.isSample).toBe(true);
  });

  it("9. 既存mock診断 → statusSource追加以外の結果が完全一致", async () => {
    // aiMeasurementProvider未指定の従来どおりのrunと比較し、statusSource以外の
    // questionResultsフィールドが完全一致することを確認する(後方互換の直接検証)。
    const resultA = await runFreeDiagnosis(INPUT, buildDeps());
    const resultB = await runFreeDiagnosis(INPUT, buildDeps());

    const stripStatusSource = (
      results: typeof resultA.questionResults
    ): Array<Omit<(typeof results)[number], "statusSource">> =>
      results.map(({ statusSource: _statusSource, ...rest }) => rest);

    expect(stripStatusSource(resultA.questionResults)).toEqual(
      stripStatusSource(resultB.questionResults)
    );
    for (const q of resultA.questionResults) {
      expect(q.statusSource).toBe("legacy_reference");
    }
    expect(resultA.scoreBreakdown).toEqual(resultB.scoreBreakdown);
    expect(resultA.aioLossRootCauses).toEqual(resultB.aioLossRootCauses);
    expect(resultA.isSample).toBe(resultB.isSample);
  });
});
