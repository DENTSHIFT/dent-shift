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
import type {
  AiMeasurementObservation,
  AiMeasurementStatus,
  AiObservationFieldProvenance,
} from "@/domain/ai-measurement/types";
import type {
  AiMeasurementObservationInput,
  AiMeasurementProvider,
} from "@/domain/ai-measurement/provider";
import { MeasurementPlanExecutionMismatchError } from "@/domain/ai-measurement/measurementCoverage";

/**
 * PatientQuestionResult.measurementCoverageの算出に関するunit test
 * (2026-09-07のユーザー指示: measurementCoverageの「加算的接続」ラウンド)。目的:
 * (a) canonical provider未指定時にmeasurementCoverageがnullのままであること
 * (b) canonical provider指定時、MEASUREMENT_PLANに基づき正しく算出されること
 * (c) plan対象providerに対応するobservationが欠落していれば明示的にエラーになること
 * (d) 追加してもscoring/root cause/topImprovements/isSampleが一切変わらないこと
 * を確認する。
 *
 * 2026-09-07の後続ラウンド(win/close/lose本接続)注記: 当初このファイルは
 * 「measurementCoverageの追加はstatusに一切影響しない」ことを前提にしていたが、本接続
 * ラウンドで意図的にその前提を変更した(MEASUREMENT_PLAN対象質問はcanonical観測で
 * status判定するようになった)。そのため一部のtest(3・4・8)はstatus/statusSourceの
 * 新しい仕様に合わせて更新している。status判定の詳細な仕様(win/close/lose/
 * insufficient_data各パターン、statusSourceの直交性等)の網羅的な検証は
 * runFreeDiagnosisCanonicalStatusBridge.test.tsで行う。
 */

const FIXED_AT = "2026-01-01T00:00:00.000Z";

// MEASUREMENT_PLANのP0対象3問(measurementPlan.tsのAI_MEASUREMENT_TARGET_QUESTIONSと同一)
const TARGETED_QUESTIONS = [
  "駅から近いおすすめの歯医者は?",
  "土日も診療している歯科医院は?",
  "評判の良い歯科医院を教えて",
];
const UNTARGETED_QUESTION = "痛みが少ないインプラント治療ができる歯科医院は?";

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

/** 全質問で自院が言及される(win想定)、通常のmock legacy provider。 */
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
      evidence: "test: mentioned",
      dataSource: "mock",
      capturedAt: FIXED_AT,
    }));
  }
}

function fieldProvenanceFor(status: AiMeasurementStatus): AiObservationFieldProvenance {
  if (status === "unavailable") {
    const cell = { measurementStatus: "unavailable" as const, derivation: null };
    return { mentioned: cell, recommendationRank: cell, citations: cell, competitorMentions: cell };
  }
  const cell = { measurementStatus: status, derivation: "derived" as const };
  return { mentioned: cell, recommendationRank: cell, citations: cell, competitorMentions: cell };
}

function buildCanonicalObservation(
  question: string,
  status: AiMeasurementStatus
): AiMeasurementObservation {
  const isUnavailable = status === "unavailable";
  return {
    question,
    providerId: "openai",
    model: "fake-canonical-model",
    sourceType: "ai_provider",
    measurementStatus: status,
    mentioned: isUnavailable ? null : true,
    recommendationRank: isUnavailable ? null : 1,
    citations: isUnavailable ? null : [],
    competitorMentions: isUnavailable ? null : [],
    region: null,
    evidence: `test: canonical ${status}`,
    unavailableReason: isUnavailable ? "temporarily_unavailable" : null,
    provisional: status === "reference",
    measurementMeta: {
      schemaVersion: "ai_observation_measurement_meta_v1",
      toolType: "web_search",
      searchExecuted: status === "measured",
      searchQueries: [],
      measurementLogicVersion: "test-logic-v1",
      promptVersion: "test-prompt-v1",
      providerResponseId: isUnavailable ? null : "resp_1",
      providerReportedModelId: isUnavailable ? null : "fake-canonical-model",
      usage: null,
      fieldProvenance: fieldProvenanceFor(status),
    },
    capturedAt: FIXED_AT,
  };
}

/**
 * 指定したquestion群にだけcanonical観測を返すfake provider。指定されていないquestion
 * (=targetProviders=[]の質問)には何も返さない(=plan側もobservationを要求しないため
 * 正常なケース)。
 */
class ConfigurableFakeAiMeasurementProvider implements AiMeasurementProvider {
  readonly name = "configurable-fake-ai-measurement-provider";
  constructor(private readonly statusByQuestion: Partial<Record<string, AiMeasurementStatus>>) {}

  async observe(input: AiMeasurementObservationInput): Promise<AiMeasurementObservation[]> {
    const results: AiMeasurementObservation[] = [];
    for (const question of input.patientQuestions) {
      const status = this.statusByQuestion[question];
      if (!status) continue;
      results.push(buildCanonicalObservation(question, status));
    }
    return results;
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
  clinicName: "measurementCoverage接続検証歯科医院",
  clinicUrl: "https://example.com",
  contactEmail: "test@example.com",
  contactPhone: "03-1234-5678",
};

function allTargetedStatuses(status: AiMeasurementStatus): Record<string, AiMeasurementStatus> {
  return Object.fromEntries(TARGETED_QUESTIONS.map((q) => [q, status]));
}

describe("PatientQuestionResult.measurementCoverage: 加算的接続(2026-09-07のユーザー指示)", () => {
  it("1. canonical provider未指定 → 全質問でmeasurementCoverage=null、既存statusは不変", async () => {
    const baseline = await runFreeDiagnosis(INPUT, buildDeps());
    expect(baseline.questionResults.every((q) => q.measurementCoverage === null)).toBe(true);
    expect(baseline.questionResults.every((q) => q.status === "win")).toBe(true);
  });

  it("2. OpenAI対象質問・measured → total=1/measured=1/isPartial=false、statusはlegacyのみの結果と同じ", async () => {
    const baseline = await runFreeDiagnosis(INPUT, buildDeps());
    const result = await runFreeDiagnosis(
      INPUT,
      buildDeps({
        aiMeasurementProvider: new ConfigurableFakeAiMeasurementProvider(
          allTargetedStatuses("measured")
        ),
      })
    );

    const target = result.questionResults.find((q) => q.question === TARGETED_QUESTIONS[0])!;
    expect(target.measurementCoverage).toEqual({
      totalProviders: 1,
      measuredProviders: 1,
      referenceProviders: 0,
      unavailableProviders: 0,
      isPartial: false,
    });
    expect(result.questionResults.map((q) => q.status)).toEqual(
      baseline.questionResults.map((q) => q.status)
    );
  });

  it("3. OpenAI対象質問・reference → total=1/reference=1/isPartial=true", async () => {
    // 2026-09-07のユーザー指示(win/close/loseへのcanonical measurement本接続ラウンド)により、
    // reference-onlyはmeasuredProviders===0となるため、対象質問はcanonical判定でstatus=
    // "insufficient_data"になる(legacy statusへのfallbackはしない)。measurementCoverage
    // 追加当初(前ラウンド)の「statusは不変」という前提は、本接続ラウンドの意図的な変更に
    // よりもう成立しない(このファイルの目的をmeasurementCoverageの数値算出確認に絞り、
    // status自体の詳細な仕様検証はrunFreeDiagnosisCanonicalStatusBridge.test.tsで行う)。
    const baseline = await runFreeDiagnosis(INPUT, buildDeps());
    const result = await runFreeDiagnosis(
      INPUT,
      buildDeps({
        aiMeasurementProvider: new ConfigurableFakeAiMeasurementProvider(
          allTargetedStatuses("reference")
        ),
      })
    );

    const target = result.questionResults.find((q) => q.question === TARGETED_QUESTIONS[0])!;
    expect(target.measurementCoverage).toEqual({
      totalProviders: 1,
      measuredProviders: 0,
      referenceProviders: 1,
      unavailableProviders: 0,
      isPartial: true,
    });
    expect(target.status).toBe("insufficient_data");
    expect(target.statusSource).toBe("canonical_measurement");
    // 対象外の質問はこのラウンドでも引き続きlegacy判定のまま(baselineと不変)。
    const untargetedBaseline = baseline.questionResults.find(
      (q) => q.question === UNTARGETED_QUESTION
    )!;
    const untargetedResult = result.questionResults.find(
      (q) => q.question === UNTARGETED_QUESTION
    )!;
    expect(untargetedResult.status).toBe(untargetedBaseline.status);
    expect(untargetedResult.statusSource).toBe("legacy_reference");
  });

  it("4. OpenAI対象質問・unavailable → total=1/unavailable=1/isPartial=true", async () => {
    // 2026-09-07のユーザー指示: unavailable-onlyもmeasuredProviders===0のためstatus=
    // "insufficient_data"になる(テスト3と同じ理由。詳細はテスト3のコメント参照)。
    const baseline = await runFreeDiagnosis(INPUT, buildDeps());
    const result = await runFreeDiagnosis(
      INPUT,
      buildDeps({
        aiMeasurementProvider: new ConfigurableFakeAiMeasurementProvider(
          allTargetedStatuses("unavailable")
        ),
      })
    );

    const target = result.questionResults.find((q) => q.question === TARGETED_QUESTIONS[0])!;
    expect(target.measurementCoverage).toEqual({
      totalProviders: 1,
      measuredProviders: 0,
      referenceProviders: 0,
      unavailableProviders: 1,
      isPartial: true,
    });
    expect(target.status).toBe("insufficient_data");
    expect(target.statusSource).toBe("canonical_measurement");
    const untargetedBaseline = baseline.questionResults.find(
      (q) => q.question === UNTARGETED_QUESTION
    )!;
    const untargetedResult = result.questionResults.find(
      (q) => q.question === UNTARGETED_QUESTION
    )!;
    expect(untargetedResult.status).toBe(untargetedBaseline.status);
    expect(untargetedResult.statusSource).toBe("legacy_reference");
  });

  it("5. targetProviders=[]の質問 → all 0 / isPartial=false(observationが無くてもエラーにならない)", async () => {
    const result = await runFreeDiagnosis(
      INPUT,
      buildDeps({
        aiMeasurementProvider: new ConfigurableFakeAiMeasurementProvider(
          allTargetedStatuses("measured")
        ),
      })
    );
    const untargeted = result.questionResults.find((q) => q.question === UNTARGETED_QUESTION)!;
    expect(untargeted.measurementCoverage).toEqual({
      totalProviders: 0,
      measuredProviders: 0,
      referenceProviders: 0,
      unavailableProviders: 0,
      isPartial: false,
    });
  });

  it("7. plan対象providerに対応するcanonical observationが欠落 → MeasurementPlanExecutionMismatchError", async () => {
    await expect(
      runFreeDiagnosis(
        INPUT,
        buildDeps({
          // 対象3問のいずれにも観測を返さないfake provider
          aiMeasurementProvider: new ConfigurableFakeAiMeasurementProvider({}),
        })
      )
    ).rejects.toThrow(MeasurementPlanExecutionMismatchError);
  });

  it("8. measurementCoverage追加前後でscoring/root cause/topImprovements/isSample/aiObservationsが変わらない", async () => {
    // 2026-09-07のユーザー指示(win/close/loseへのcanonical measurement本接続ラウンド)により、
    // MEASUREMENT_PLAN対象質問(TARGETED_QUESTIONS)はcanonical観測で判定されるようになった。
    // ここでは全対象質問をmentioned=true/rank=1のmeasuredにしているため、legacy判定と同じ
    // "win"になりstatus自体は変わらないが、evidence(観測元の文言)とstatusSourceは意図的に
    // 変わる(F: canonical/legacy非混在保証。判定に使った観測をそのままevidenceに反映するため)。
    // よって対象質問はstatus/measurementCoverage以外は完全一致を求めず、対象外の質問のみ
    // measurementCoverage以外の完全一致を求める。
    const baseline = await runFreeDiagnosis(INPUT, buildDeps());
    const withCoverage = await runFreeDiagnosis(
      INPUT,
      buildDeps({
        aiMeasurementProvider: new ConfigurableFakeAiMeasurementProvider(
          allTargetedStatuses("measured")
        ),
      })
    );

    expect(withCoverage.scoreBreakdown).toEqual(baseline.scoreBreakdown);
    expect(withCoverage.aioLossRootCauses).toEqual(baseline.aioLossRootCauses);
    expect(withCoverage.topImprovements).toEqual(baseline.topImprovements);
    expect(withCoverage.isSample).toBe(baseline.isSample);
    expect(withCoverage.aiObservations).toEqual(baseline.aiObservations);

    const stripCoverage = (
      results: typeof baseline.questionResults
    ): Array<Omit<(typeof results)[number], "measurementCoverage">> =>
      results.map(({ measurementCoverage: _measurementCoverage, ...rest }) => rest);

    const isTargeted = (question: string) => TARGETED_QUESTIONS.includes(question);
    const untargetedBaseline = stripCoverage(baseline.questionResults).filter(
      (q) => !isTargeted(q.question)
    );
    const untargetedWithCoverage = stripCoverage(withCoverage.questionResults).filter(
      (q) => !isTargeted(q.question)
    );
    // 対象外の質問はmeasurementCoverage以外(status/evidence/root cause属性/statusSource含む)
    // が完全一致する(legacy判定のまま変わらないため)。
    expect(untargetedWithCoverage).toEqual(untargetedBaseline);

    // 対象質問はstatus(=win)自体はbaselineと一致するが、canonical判定に切り替わった
    // ことを示すstatusSourceは変わる。
    for (const question of TARGETED_QUESTIONS) {
      const before = baseline.questionResults.find((q) => q.question === question)!;
      const after = withCoverage.questionResults.find((q) => q.question === question)!;
      expect(after.status).toBe(before.status);
      expect(before.statusSource).toBe("legacy_reference");
      expect(after.statusSource).toBe("canonical_measurement");
    }
  });
});
