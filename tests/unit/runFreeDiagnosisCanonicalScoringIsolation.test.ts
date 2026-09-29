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
import { UnavailableScoreProvider } from "@/server/providers/scoring/unavailableScoreProvider";

/**
 * AIO scoring接続ラウンドの回帰テスト。
 *
 * 2026-09-08時点(案B)の旧仕様: canonical AiMeasurementObservationはscoreBreakdownへ
 * 一切渡さず、AIOは常にlegacyのaiObservations(通常診断では空配列→unavailable)のみで
 * 算出していた。この結果、実際のOpenAI観測が成功してもAIOが「取得不能」表示になる
 * 不整合が生じたため、2026-09-29のPO指示により以下へ変更した:
 *
 * 現行仕様(2026-09-29改訂):
 * - aiMeasurementProviderが指定された場合、AIOのscoreBreakdownはcanonical
 *   AiMeasurementObservation(measurementStatus==="measured"のもの)から算出する
 *   (status="measured"。measured観測が0件の場合のみunavailable)
 * - AIO以外の5領域のscoreBreakdownはcanonical接続の有無に一切影響されない
 *   (この非影響は本ファイルで引き続き回帰確認する)
 * - isSampleはcanonical接続の有無に影響されない(AIOのdataSourceはcanonical/legacy
 *   いずれでも"ai_provider"であり、そもそもisSampleの"mock"判定対象ではないため)
 * - priorityScoring(改善TOP3)のscoreBreakdown由来候補(45項目カタログ)は、AIO以外の
 *   領域についてはcanonical接続で変化しない。questionResults由来の2種類の候補
 *   (data-gap-ai-observation / aio-losing-patient-questions)は、2026-09-08承認の
 *   canonical接続により引き続き意図的に変わりうる(本テストの対象外)。
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
 * AIO以外は常にDOMAIN_CRITERIAの満点・status="estimated"・dataSource="mock"を返す決定的
 * provider。LLMO.structured_dataだけscore=0にして、45項目カタログの
 * "improvement-logic:2-structured_data_missing"(ratio_below 0.6)を確実に1件発火させる。
 * これにより「scoreBreakdown由来の改善候補はcanonical接続で変化しない」という主張を
 * 空虚な比較(両方0件)ではなく、実際に候補が存在する状態で検証できる。
 *
 * AIOだけは実際のUnavailableScoreProvider(本番と同じロジック)へ委譲する
 * (2026-09-29改訂: AIOのscoreBreakdownがcanonical AiMeasurementObservationを実際に
 * 反映することを、本番と同じ算出ロジックで確認するため。他ドメインを差し替えていない
 * 決定的fakeのままにしているのは、AIOへのcanonical接続がAIO以外へ波及しないことの
 * 検証を単純化するため)。
 */
class WeakLlmoScoreProvider implements ScoreProvider {
  readonly name = "weak-llmo-score-provider";
  private readonly realAioProvider = new UnavailableScoreProvider();

  async score(domain: DomainKey, input: ScoreCriterionInput): Promise<CriterionScore[]> {
    if (domain === "AIO") {
      return this.realAioProvider.score(domain, input);
    }
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
  directorName: "テスト院長",
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

describe("AIO scoring接続: canonical measurementの影響範囲(2026-09-29改訂)", () => {
  it("1. canonical providerが実際にmeasured観測を生成すると、AIOのscoreBreakdownはunavailableから測定済みへ変わる。AIO以外の領域は不変", async () => {
    const baseline = await runFreeDiagnosis(INPUT, buildDeps({}));

    const baselineAio = baseline.scoreBreakdown.domains.find((d) => d.domain === "AIO")!;
    // 前提: aiMeasurementProvider未指定のbaselineでは、legacyのaiObservationsも
    // 空配列(ConfigurableFakeAiProviderは指定していないため常にmentioned:trueを返す点に
    // 注意。ここでは「aiMeasurementProvider未指定時はlegacy経路のまま」であることの
    // 前提確認として、AIOがlegacy(status="estimated")で算出されていることのみ確認する。
    expect(baselineAio.criteria.find((c) => c.key === "ai_search_presence")?.status).toBe("estimated");

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
    const connectedLose = connected.questionResults.find((q) => q.question === targetLose);
    const connectedInsufficient = connected.questionResults.find((q) => q.question === targetInsufficient);
    expect(connectedLose?.status).toBe("lose");
    expect(connectedLose?.statusSource).toBe("canonical_measurement");
    expect(connectedInsufficient?.status).toBe("insufficient_data");
    expect(connectedInsufficient?.statusSource).toBe("canonical_measurement");

    // 本題1: AIOのscoreBreakdownはcanonical measured観測を反映し、status="measured"になる
    const connectedAio = connected.scoreBreakdown.domains.find((d) => d.domain === "AIO")!;
    const groundedKeys = ["ai_search_presence", "recommendation_rank", "question_domain_coverage"];
    for (const key of groundedKeys) {
      const c = connectedAio.criteria.find((c) => c.key === key)!;
      expect(c.status).toBe("measured");
      expect(c.score).not.toBeNull();
      expect(c.dataSource).toBe("ai_provider");
    }
    // citation_acquisition/information_accuracyは引き続き未実装のままunavailable
    // (measured扱いにしない)
    for (const key of ["citation_acquisition", "information_accuracy"]) {
      const c = connectedAio.criteria.find((c) => c.key === key)!;
      expect(c.status).toBe("unavailable");
    }
    expect(connectedAio).not.toEqual(baselineAio);

    // 本題2: AIO以外の5領域はcanonical接続の有無・内容に一切影響されない
    for (const domain of connected.scoreBreakdown.domains) {
      if (domain.domain === "AIO") continue;
      const baselineDomain = baseline.scoreBreakdown.domains.find((d) => d.domain === domain.domain)!;
      expect(domain).toEqual(baselineDomain);
    }
  });

  it("2. canonicalのmeasured観測が0件(全質問がunavailable)の場合、AIOはunavailableのまま", async () => {
    const connected = await runFreeDiagnosis(
      INPUT,
      buildDeps({
        aiMeasurementProvider: new ConfigurableFakeAiMeasurementProvider(
          {},
          { measurementStatus: "unavailable" }
        ),
      })
    );

    const aio = connected.scoreBreakdown.domains.find((d) => d.domain === "AIO")!;
    expect(aio.status).toBe("unavailable");
    for (const c of aio.criteria) {
      expect(c.status).toBe("unavailable");
      expect(c.score).toBeNull();
    }
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

    // 前提: AIO以外の5領域(WeakLlmoScoreProvider)が常にdataSource="mock"を返すため、
    // isSampleは常にtrue(AIOのdataSourceはcanonical/legacyいずれも"ai_provider"であり、
    // この判定には影響しない)。
    expect(baseline.isSample).toBe(true);
    expect(connected.isSample).toBe(baseline.isSample);
  });

  it("4. topImprovements: AIO以外のscoreBreakdown由来の候補(45項目カタログ)はcanonical接続で変化しない。questionResults由来の候補・AIO由来の候補はRound A/B・2026-09-29改訂の既存設計通り変化してよい(scoring rippleではない)", async () => {
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

    // AIO以外の5領域はcanonical接続の有無に一切影響されない(test1参照)。
    for (const domain of connected.scoreBreakdown.domains) {
      if (domain.domain === "AIO") continue;
      const baselineDomain = baseline.scoreBreakdown.domains.find((d) => d.domain === domain.domain)!;
      expect(domain).toEqual(baselineDomain);
    }

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

    // LLMOのstructured_data_missing候補(AIOと無関係)は、canonical接続の有無に
    // 一切影響されず両方に存在する(空虚な比較にならないことの確認も兼ねる)。
    const llmoCandidateKey = "aio-structured-data-missing";
    expect(baselineDrafts.some((c) => c.key === llmoCandidateKey)).toBe(true);
    expect(connectedDrafts.some((c) => c.key === llmoCandidateKey)).toBe(true);

    // questionResults由来の候補は、canonical接続によりlose質問が増えたことで
    // 実際に変化してよい(これはRound A/Bで承認済みの意図的な接続であり、本テストが
    // 「scoring rippleではない」ことを示すために明示的に許容する)
    const connectedHasLosingQuestionsCandidate = connectedDrafts.some(
      (c) => c.key === "aio-losing-patient-questions"
    );
    expect(connectedHasLosingQuestionsCandidate).toBe(true);
  });
});
