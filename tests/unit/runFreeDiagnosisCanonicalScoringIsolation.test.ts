import { describe, expect, it } from "vitest";
import { runFreeDiagnosis } from "@/server/services/runFreeDiagnosis";
import type { RunFreeDiagnosisDeps } from "@/server/services/runFreeDiagnosis";
import { generateImprovementCandidates } from "@/domain/improvement-task/priorityScoring";
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
 * AIO scoring接続ラウンド(2026-09-08のユーザー指示、案B確定)の回帰テスト。
 *
 * 案Bの確定仕様:
 * - canonical AiMeasurementObservationは既存AIO30点のscoreAio()へ渡さない
 * - scoreBreakdown / overallScore(scoreBreakdown.totalPoints/coverage/totalStatus)は
 *   canonical providerの有無・canonical側のwin/close/lose/insufficient_dataの実際の発生に
 *   一切影響されない
 * - isSampleも同様に不変
 * - priorityScoring(改善TOP3)への入力のうちscoreBreakdown由来の候補(45項目カタログ・
 *   domain data_gap)はcanonical接続の影響を受けない。questionResults由来の2種類の候補
 *   (data-gap-ai-observation / aio-losing-patient-questions)は、Round A/Bで承認済みの
 *   canonical接続により意図的に変わりうる(これは「スコアリングへのripple」ではなく、
 *   質問単位のcanonical接続が正しく機能している証拠であり、本テストの対象外)。
 *
 * このテストはproduction scoring logic(scoreAio/buildScoreBreakdown/calculateDomainScore/
 * priorityScoring/candidateCatalog)を一切変更せずに追加した回帰テストであり、
 * 乱数(seededRandom)への依存を避けるため、既存のcanonical root cause bridge testと同じ
 * 決定的なFakeScoreProvider(fullHealthCriteria)パターンを踏襲する。
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

/**
 * 常にDOMAIN_CRITERIAの満点・status="estimated"・dataSource="mock"を返す決定的provider。
 * ただしLLMO.structured_dataだけscore=0にして、45項目カタログの
 * "improvement-logic:2-structured_data_missing"(ratio_below 0.6)を確実に1件発火させる。
 * これにより「scoreBreakdown由来の改善候補はcanonical接続で変化しない」という主張を
 * 空虚な比較(両方0件)ではなく、実際に候補が存在する状態で検証できる。
 */
class WeakLlmoScoreProvider implements ScoreProvider {
  readonly name = "weak-llmo-score-provider";
  async score(domain: DomainKey, _input: ScoreCriterionInput): Promise<CriterionScore[]> {
    const criteria = fullHealthCriteria(domain);
    if (domain === "LLMO") {
      const structuredData = criteria.find((c) => c.key === "structured_data");
      if (structuredData) {
        structuredData.score = 0;
      }
    }
    return criteria;
  }
}

interface LegacyQuestionSpec {
  mentioned: boolean;
  competitorMentions?: string[];
  evidence?: string;
}

/** 質問ごとにmentioned/competitorMentionsを設定できるlegacy mock provider(dataSourceは常にmock)。 */
class ConfigurableFakeAiProvider implements AiProvider {
  readonly name = "configurable-fake-ai-provider-scoring-isolation";
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
    citations: isUnavailable ? null : [],
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

const TARGETED_QUESTIONS = MEASUREMENT_PLAN.questions
  .filter((q) => q.targetProviders.length > 0)
  .map((q) => q.question);

/** MEASUREMENT_PLAN対象質問すべてに観測を返す(未指定分はdefaultSpecで埋める)fake canonical provider。 */
class ConfigurableFakeAiMeasurementProvider implements AiMeasurementProvider {
  readonly name = "configurable-fake-ai-measurement-provider-scoring-isolation";
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
    scoreProvider: new WeakLlmoScoreProvider(),
    adComplianceProvider: new FakeAdComplianceProvider(),
    ...overrides,
  };
}

const INPUT = {
  clinicName: "AIO scoring isolation検証歯科医院",
  clinicUrl: "https://example.com",
  contactEmail: "test@example.com",
  contactPhone: "03-1234-5678",
};

// questionResults由来で、canonical接続により意図的に変化しうる候補(Round A/Bで承認済み)。
// scoring isolationの検証対象からは除外する。
const QUESTION_RESULT_DRIVEN_CANDIDATE_KEYS = new Set([
  "data-gap-ai-observation",
  "aio-losing-patient-questions",
]);

describe("AIO scoring接続: canonical measurementのscoring isolation(2026-09-08のユーザー指示、案B)", () => {
  it("1. canonical providerがwin/lose/insufficient_dataを実際に生成しても、scoreBreakdownは完全に不変", async () => {
    const baseline = await runFreeDiagnosis(INPUT, buildDeps({}));

    const [targetWin, targetLose, targetInsufficient] = TARGETED_QUESTIONS;
    const connected = await runFreeDiagnosis(
      INPUT,
      buildDeps({
        aiMeasurementProvider: new ConfigurableFakeAiMeasurementProvider({
          [targetWin!]: { measurementStatus: "measured", mentioned: true },
          [targetLose!]: {
            measurementStatus: "measured",
            mentioned: false,
            competitorMentions: ["Canonical Competitor X"],
          },
          [targetInsufficient!]: { measurementStatus: "unavailable" },
        }),
      })
    );

    // 前提確認: canonicalが実際にbaselineと異なるwin/lose/insufficient_dataを生成していること
    // (この確認がないと、scoreBreakdown一致が「そもそもcanonicalが何もしていないから一致した」
    // という空虚な結果になりかねない)
    const connectedLose = connected.questionResults.find((q) => q.question === targetLose);
    const connectedInsufficient = connected.questionResults.find((q) => q.question === targetInsufficient);
    const baselineLose = baseline.questionResults.find((q) => q.question === targetLose);
    const baselineInsufficient = baseline.questionResults.find((q) => q.question === targetInsufficient);
    expect(connectedLose?.status).toBe("lose");
    expect(connectedLose?.statusSource).toBe("canonical_measurement");
    expect(baselineLose?.status).not.toBe("lose"); // legacy defaultはmentioned:trueなのでwin
    expect(connectedInsufficient?.status).toBe("insufficient_data");
    expect(connectedInsufficient?.statusSource).toBe("canonical_measurement");
    expect(baselineInsufficient?.status).not.toBe("insufficient_data");

    // 本題: scoreBreakdown(AIOを含む全ドメイン)はcanonical接続の有無・内容に一切影響されない
    expect(connected.scoreBreakdown).toEqual(baseline.scoreBreakdown);
  });

  it("2. overallScore相当のフィールド(totalPoints/coverage/totalStatus/assessedMaxPoints)も不変", async () => {
    const baseline = await runFreeDiagnosis(INPUT, buildDeps({}));
    const connected = await runFreeDiagnosis(
      INPUT,
      buildDeps({
        aiMeasurementProvider: new ConfigurableFakeAiMeasurementProvider({
          [TARGETED_QUESTIONS[0]!]: {
            measurementStatus: "measured",
            mentioned: false,
            competitorMentions: ["Canonical Competitor Y"],
          },
          [TARGETED_QUESTIONS[1]!]: { measurementStatus: "unavailable" },
        }),
      })
    );

    expect(connected.scoreBreakdown.maxPoints).toBe(baseline.scoreBreakdown.maxPoints);
    expect(connected.scoreBreakdown.assessedMaxPoints).toBe(baseline.scoreBreakdown.assessedMaxPoints);
    expect(connected.scoreBreakdown.totalPoints).toBe(baseline.scoreBreakdown.totalPoints);
    expect(connected.scoreBreakdown.coverage).toBe(baseline.scoreBreakdown.coverage);
    expect(connected.scoreBreakdown.totalStatus).toBe(baseline.scoreBreakdown.totalStatus);
  });

  it("3. isSampleはcanonical接続の有無・内容に一切影響されない", async () => {
    const baseline = await runFreeDiagnosis(INPUT, buildDeps({}));
    const connected = await runFreeDiagnosis(
      INPUT,
      buildDeps({
        aiMeasurementProvider: new ConfigurableFakeAiMeasurementProvider({
          [TARGETED_QUESTIONS[0]!]: { measurementStatus: "measured", mentioned: true },
        }),
      })
    );

    // 前提: AIOの5criterionが常にdataSource="mock"であるため、現状isSampleは常にtrue
    expect(baseline.isSample).toBe(true);
    expect(connected.isSample).toBe(baseline.isSample);
  });

  it("4. topImprovements: scoreBreakdown由来の候補(45項目カタログ)はcanonical接続で変化しない。questionResults由来の候補はRound A/Bの既存設計通り変化してよい(scoring rippleではない)", async () => {
    const baseline = await runFreeDiagnosis(INPUT, buildDeps({}));
    const connected = await runFreeDiagnosis(
      INPUT,
      buildDeps({
        aiMeasurementProvider: new ConfigurableFakeAiMeasurementProvider({
          [TARGETED_QUESTIONS[0]!]: {
            measurementStatus: "measured",
            mentioned: false,
            competitorMentions: ["Canonical Competitor Z"],
          },
        }),
      })
    );

    // scoreBreakdownは既にtest1で不変が確認済み(ここでも前提として再確認)
    expect(connected.scoreBreakdown).toEqual(baseline.scoreBreakdown);

    // generateImprovementCandidates()を同一breakdown・異なるquestionResultsで直接比較する。
    // (公開フィールドtopImprovementsはTOP3選定・ランキングを経るため、無関係な候補の
    // 入れ替わりで比較が不安定になりうる。候補生成レイヤーで比較する方が本質的で確定的)
    const baselineDrafts = generateImprovementCandidates({
      breakdown: baseline.scoreBreakdown,
      questionResults: baseline.questionResults,
      adComplianceFindings: baseline.adComplianceChecks.findings,
    });
    const connectedDrafts = generateImprovementCandidates({
      breakdown: connected.scoreBreakdown,
      questionResults: connected.questionResults,
      adComplianceFindings: connected.adComplianceChecks.findings,
    });

    const nonQuestionDrivenBaseline = baselineDrafts.filter(
      (c) => !QUESTION_RESULT_DRIVEN_CANDIDATE_KEYS.has(c.key)
    );
    const nonQuestionDrivenConnected = connectedDrafts.filter(
      (c) => !QUESTION_RESULT_DRIVEN_CANDIDATE_KEYS.has(c.key)
    );

    // 空虚な比較(両方0件)ではないことの確認: WeakLlmoScoreProviderにより
    // structured_data_missing候補が必ず1件存在する
    expect(nonQuestionDrivenBaseline.length).toBeGreaterThan(0);
    expect(nonQuestionDrivenConnected).toEqual(nonQuestionDrivenBaseline);

    // questionResults由来の候補は、canonical接続によりlose質問が増えたことで
    // 実際に変化してよい(これはRound A/Bで承認済みの意図的な接続であり、本テストが
    // 「scoring rippleではない」ことを示すために明示的に許容する)
    const connectedHasLosingQuestionsCandidate = connectedDrafts.some(
      (c) => c.key === "aio-losing-patient-questions"
    );
    expect(connectedHasLosingQuestionsCandidate).toBe(true);
  });
});
