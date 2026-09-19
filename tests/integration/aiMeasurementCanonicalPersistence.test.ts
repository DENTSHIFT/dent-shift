import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runFreeDiagnosis } from "@/server/services/runFreeDiagnosis";
import type { RunFreeDiagnosisDeps, RunFreeDiagnosisInput } from "@/server/services/runFreeDiagnosis";
import type { AiObservationInput, AiObservationResult, AiProvider } from "@/server/providers/ai/types";
import type { CompetitorProvider } from "@/server/providers/competitor/types";
import type { CompetitorClinic } from "@/domain/competitor/types";
import type { CriterionScore, DomainKey } from "@/domain/diagnosis/types";
import type { ScoreCriterionInput, ScoreProvider } from "@/server/providers/scoring/types";
import type { AdComplianceCheckInput, AdComplianceProvider } from "@/server/providers/ad-compliance/types";
import type { RawAdRiskFinding } from "@/domain/ad-compliance/types";
import { DOMAIN_CRITERIA } from "@/domain/diagnosis/scoreCriteria";
import type {
  AiMeasurementObservation,
  AiObservationFieldProvenance,
} from "@/domain/ai-measurement/types";
import type {
  AiMeasurementObservationInput,
  AiMeasurementProvider,
} from "@/domain/ai-measurement/provider";
import { AiMeasurementInvariantViolationError } from "@/domain/ai-measurement/invariants";
import { MEASUREMENT_PLAN } from "@/domain/ai-measurement/measurementPlan";
import { applyPrismaMigrationsToTestDatabase } from "../helpers/testDatabase";

/**
 * 「APIなしのcanonical persistence bridge」(2026-09-07のユーザー指示)のrepository永続化を
 * 検証する実DB(SQLite)結合テスト。
 *
 * 目的: fixture/fakeで生成したAiMeasurementObservationが
 *   runFreeDiagnosis → RunFreeDiagnosisResult → diagnosisRepository → AiObservation DB
 * まで、measurementStatus/null/[]/measurementMeta/provenanceを失わず保存できることの確認。
 * (integration/diagnosisRepository.test.tsと同じdisposable SQLiteパターンを踏襲する。
 *  各testファイルが自己完結する既存方針に従い、providerクラスもこのファイル専用に定義する。)
 *
 * 2026-09-07追記(measurementCoverage加算的接続後のfixture修正): runFreeDiagnosis()は
 * questionResults生成時にMEASUREMENT_PLANのtargetProviders=["openai"]である全質問について
 * computeMeasurementCoverage()を実行し、対応するcanonical observationが1件も無ければ
 * MeasurementPlanExecutionMismatchErrorをthrowする(仕様は緩めない)。このfixtureは各CASEの
 * 検証対象observation以外の、plan対象となっている残り質問すべてを
 * createValidMeasuredObservation()で埋めることで、この契約を満たす
 * (MEASUREMENT_PLANを直接importし、テスト側で質問名を再ハードコードしない)。
 */

let testDbDir: string;
let repo: typeof import("@/server/db/diagnosisRepository");
let prisma: import("@prisma/client").PrismaClient;

beforeAll(async () => {
  // macOSではPrisma schema engineが`/var/folders/...`配下を使えない制限環境がある。
  // OSの一時領域である`/tmp`の実体パスへ寄せ、通常環境ではtmpdir()を使う。
  const testTmpRoot =
    process.platform === "darwin" ? realpathSync("/tmp") : realpathSync(tmpdir());
  testDbDir = mkdtempSync(path.join(testTmpRoot, "dent-shift-test-db-canonical-"));
  const testDbPath = path.join(testDbDir, "test.db");
  process.env.DATABASE_URL = `file:${testDbPath}`;

  applyPrismaMigrationsToTestDatabase(testDbPath);

  repo = await import("@/server/db/diagnosisRepository");
  const clientModule = await import("@/server/db/prismaClient");
  prisma = clientModule.prisma;
}, 60000);

afterAll(async () => {
  await prisma?.$disconnect();
  if (testDbDir) rmSync(testDbDir, { recursive: true, force: true });
});

function mockCriteria(domain: DomainKey): CriterionScore[] {
  return DOMAIN_CRITERIA[domain].map((def) => ({
    key: def.key,
    label: def.label,
    maxScore: def.maxScore,
    score: def.maxScore,
    status: "estimated",
    evidence: [{ summary: "integration test: mock" }],
    measuredAt: "2026-01-01T00:00:00.000Z",
    dataSource: "mock",
    unavailableReason: null,
  }));
}

class FakeScoreProvider implements ScoreProvider {
  readonly name = "canonical-bridge-fake-score-provider";
  async score(domain: DomainKey, _input: ScoreCriterionInput): Promise<CriterionScore[]> {
    return mockCriteria(domain);
  }
}

class EmptyCompetitorProvider implements CompetitorProvider {
  readonly name = "canonical-bridge-fake-competitor-provider";
  async findNearbyCompetitors(): Promise<CompetitorClinic[]> {
    return [];
  }
}

class NoFindingsAdComplianceProvider implements AdComplianceProvider {
  readonly name = "canonical-bridge-fake-ad-compliance-provider";
  async check(_input: AdComplianceCheckInput): Promise<RawAdRiskFinding[]> {
    return [];
  }
}

/** 最初の質問1件のみ、自院が言及される通常のmock legacy観測を返す。 */
class SingleMockAiProvider implements AiProvider {
  readonly name = "canonical-bridge-fake-ai-provider";
  async observe(input: AiObservationInput): Promise<AiObservationResult[]> {
    const [first] = input.patientQuestions;
    if (!first) return [];
    return [
      {
        question: first,
        aiProvider: "chatgpt",
        model: "mock-model",
        mentioned: true,
        recommendationRank: 1,
        competitorMentions: [],
        citations: [],
        region: null,
        evidence: "integration test: legacy mock観測(canonical bridgeとは無関係)",
        dataSource: "mock",
        capturedAt: "2026-01-01T00:00:00.000Z",
      },
    ];
  }
}

/**
 * MEASUREMENT_PLANでtargetProviders=["openai"]となっている質問一覧(現在は質問1・3・5)。
 * 質問名をテスト側でハードコードせず、production側のMEASUREMENT_PLANを直接参照する
 * (2026-09-07のユーザー指示)。production codeそのものは変更しない(read-onlyで参照するのみ)。
 */
const OPENAI_TARGETED_QUESTIONS = MEASUREMENT_PLAN.questions
  .filter((q) => q.targetProviders.includes("openai"))
  .map((q) => q.question);

/**
 * 検証対象の1件(最初の質問)にはCASEごとに指定されたbuildObservationをそのまま使う。
 * それ以外の、MEASUREMENT_PLAN上でtargetProviders=["openai"]な質問(=検証対象ではない
 * plan対象質問)は、computeMeasurementCoverage()のplan対象provider観測欠落チェック
 * (MeasurementPlanExecutionMismatchError、緩めない)を満たすため、
 * createValidMeasuredObservation()で機械的に埋める(2026-09-07のユーザー指示: fixture側を
 * 現在のmeasurement plan契約へ合わせる)。
 */
class FixedCanonicalAiMeasurementProvider implements AiMeasurementProvider {
  readonly name = "canonical-bridge-fake-ai-measurement-provider";
  constructor(private readonly buildObservation: (question: string) => AiMeasurementObservation) {}
  async observe(input: AiMeasurementObservationInput): Promise<AiMeasurementObservation[]> {
    const [first] = input.patientQuestions;
    if (!first) return [];

    const observations: AiMeasurementObservation[] = [this.buildObservation(first)];

    for (const question of OPENAI_TARGETED_QUESTIONS) {
      if (question === first) continue; // 検証対象質問はbuildObservationの結果のみを使う(重複させない)
      if (!input.patientQuestions.includes(question)) continue;
      observations.push(createValidMeasuredObservation(question));
    }

    return observations;
  }
}

/**
 * plan対象provider観測の欠落エラーを避けるための、domain invariantを満たす有効な補完
 * canonical observationを生成するhelper(2026-09-07のユーザー指示)。各CASEの検証対象では
 * ない、MEASUREMENT_PLAN上の残りのplan対象質問を埋めるためだけに使う
 * (providerId="openai" / sourceType="ai_provider" / measurementStatus="measured" /
 *  有効なmeasurementMeta・provisional・mentioned等、invariantを満たす値のみを持つ)。
 */
function createValidMeasuredObservation(question: string): AiMeasurementObservation {
  return {
    question,
    providerId: "openai",
    model: "gpt-search-fixture-model",
    sourceType: "ai_provider",
    measurementStatus: "measured",
    mentioned: true,
    recommendationRank: 1,
    citations: ["https://example-clinic.jp/filler"],
    competitorMentions: [],
    region: null,
    evidence: "integration test: plan対象質問の補完用observation(このCASEの検証対象ではない)",
    unavailableReason: null,
    provisional: false,
    measurementMeta: {
      schemaVersion: "ai_observation_measurement_meta_v1",
      toolType: "web_search",
      searchExecuted: true,
      searchQueries: ["filler query"],
      measurementLogicVersion: "test-logic-v1",
      promptVersion: "test-prompt-v1",
      providerResponseId: "resp_filler",
      providerReportedModelId: "gpt-search-fixture-model",
      usage: { inputTokens: 10, outputTokens: 5, toolCallCount: 1 },
      fieldProvenance: measuredFieldProvenance(),
    },
    capturedAt: "2026-01-01T00:00:00.000Z",
  };
}

function measuredFieldProvenance(): AiObservationFieldProvenance {
  return {
    mentioned: { measurementStatus: "measured", derivation: "derived" },
    recommendationRank: { measurementStatus: "measured", derivation: "estimated" },
    citations: { measurementStatus: "measured", derivation: "direct" },
    competitorMentions: { measurementStatus: "measured", derivation: "derived" },
  };
}

function referenceFieldProvenance(): AiObservationFieldProvenance {
  return {
    mentioned: { measurementStatus: "reference", derivation: "derived" },
    recommendationRank: { measurementStatus: "reference", derivation: "estimated" },
    citations: { measurementStatus: "reference", derivation: "direct" },
    competitorMentions: { measurementStatus: "reference", derivation: "derived" },
  };
}

function unavailableFieldProvenance(): AiObservationFieldProvenance {
  const cell = { measurementStatus: "unavailable" as const, derivation: null };
  return { mentioned: cell, recommendationRank: cell, citations: cell, competitorMentions: cell };
}

// CASE 1: measured
function buildMeasuredObservation(question: string): AiMeasurementObservation {
  return {
    question,
    providerId: "openai",
    model: "gpt-search-fixture-model",
    sourceType: "ai_provider",
    measurementStatus: "measured",
    mentioned: true,
    recommendationRank: 1,
    citations: ["https://example-clinic.jp/page"],
    competitorMentions: ["みどり歯科医院"],
    region: null,
    evidence: "integration test: CASE1 measured",
    unavailableReason: null,
    provisional: false,
    measurementMeta: {
      schemaVersion: "ai_observation_measurement_meta_v1",
      toolType: "web_search",
      searchExecuted: true,
      searchQueries: ["駅前 歯科"],
      measurementLogicVersion: "test-logic-v1",
      promptVersion: "test-prompt-v1",
      providerResponseId: "resp_case1",
      providerReportedModelId: "gpt-search-fixture-model",
      usage: { inputTokens: 120, outputTokens: 60, toolCallCount: 1 },
      fieldProvenance: measuredFieldProvenance(),
    },
    capturedAt: "2026-01-01T00:00:00.000Z",
  };
}

// CASE 2: reference
function buildReferenceObservation(question: string): AiMeasurementObservation {
  return {
    question,
    providerId: "openai",
    model: "gpt-search-fixture-model",
    sourceType: "ai_provider",
    measurementStatus: "reference",
    mentioned: true,
    recommendationRank: 1,
    citations: [],
    competitorMentions: [],
    region: null,
    evidence: "integration test: CASE2 reference",
    unavailableReason: null,
    provisional: true,
    measurementMeta: {
      schemaVersion: "ai_observation_measurement_meta_v1",
      toolType: "web_search",
      searchExecuted: false,
      searchQueries: [],
      measurementLogicVersion: "test-logic-v1",
      promptVersion: "test-prompt-v1",
      providerResponseId: "resp_case2",
      providerReportedModelId: "gpt-search-fixture-model",
      usage: null,
      fieldProvenance: referenceFieldProvenance(),
    },
    capturedAt: "2026-01-01T00:00:01.000Z",
  };
}

// CASE 3: unavailable
function buildUnavailableObservation(question: string): AiMeasurementObservation {
  return {
    question,
    providerId: "openai",
    model: "gpt-search-fixture-model",
    sourceType: "ai_provider",
    measurementStatus: "unavailable",
    mentioned: null,
    recommendationRank: null,
    citations: null,
    competitorMentions: null,
    region: null,
    evidence: "integration test: CASE3 unavailable",
    unavailableReason: "temporarily_unavailable",
    provisional: false,
    measurementMeta: {
      schemaVersion: "ai_observation_measurement_meta_v1",
      toolType: "web_search",
      searchExecuted: false,
      searchQueries: [],
      measurementLogicVersion: "test-logic-v1",
      promptVersion: "test-prompt-v1",
      providerResponseId: null,
      providerReportedModelId: null,
      usage: null,
      fieldProvenance: unavailableFieldProvenance(),
    },
    capturedAt: "2026-01-01T00:00:02.000Z",
  };
}

// CASE 4: invalid(domain invariant違反。measurementStatus="unavailable"なのにmentioned=false)
function buildInvalidObservation(question: string): AiMeasurementObservation {
  return {
    ...buildUnavailableObservation(question),
    mentioned: false,
  };
}

function buildDeps(
  aiMeasurementProvider: AiMeasurementProvider,
  aiProvider: AiProvider = new SingleMockAiProvider()
): RunFreeDiagnosisDeps {
  return {
    aiProvider,
    competitorProvider: new EmptyCompetitorProvider(),
    scoreProvider: new FakeScoreProvider(),
    adComplianceProvider: new NoFindingsAdComplianceProvider(),
    aiMeasurementProvider,
  };
}

function buildInput(clinicName: string): RunFreeDiagnosisInput {
  return {
    clinicName,
    clinicUrl: "https://example.com",
    contactEmail: "test@example.com",
    contactPhone: "03-1234-5678",
  };
}

describe("canonical persistence bridge: AiMeasurementObservationの保存(2026-09-07のユーザー指示)", () => {
  it("CASE1 measured: measurementStatus/provisional/measurementMetaJson/citations/competitorMentionsが正しく保存される", async () => {
    const deps = buildDeps(new FixedCanonicalAiMeasurementProvider(buildMeasuredObservation));
    const result = await runFreeDiagnosis(buildInput("canonical CASE1歯科医院"), deps);
    // 検証対象1件 + MEASUREMENT_PLAN上の残りのplan対象質問を埋める補完observation
    expect(result.aiMeasurementObservations?.length).toBe(OPENAI_TARGETED_QUESTIONS.length);

    const saved = await repo.saveDiagnosisResult(
      { clinicUrl: "https://example.com", contactEmail: "test@example.com" },
      result
    );

    // 補完observation(複数)と検証対象observationが同じprovider="openai"で複数行保存されるため、
    // このCASEに固有のevidence文字列で検証対象の行だけを一意に絞り込む
    const dbRow = await prisma.aiObservation.findFirst({
      where: { diagnosisId: saved.diagnosisId, provider: "openai", evidence: "integration test: CASE1 measured" },
    });
    expect(dbRow).not.toBeNull();
    expect(dbRow!.provider).toBe("openai");
    expect(dbRow!.sourceType).toBe("ai_provider");
    expect(dbRow!.measurementStatus).toBe("measured");
    expect(dbRow!.provisional).toBe(false);
    expect(dbRow!.measurementMetaJson).not.toBeNull();
    expect(JSON.parse(dbRow!.measurementMetaJson!).providerResponseId).toBe("resp_case1");
    expect(dbRow!.mention).toBe(true);
    expect(dbRow!.rank).toBe(1);
    expect(JSON.parse(dbRow!.citationsJson!)).toEqual(["https://example-clinic.jp/page"]);
    expect(JSON.parse(dbRow!.competitorsJson!)).toEqual(["みどり歯科医院"]);
    expect(dbRow!.unavailableReason).toBeNull();

    // legacy観測(SingleMockAiProvider由来)も同じdiagnosisに引き続き保存されている
    // (canonicalの追加がlegacy側を消さないことの確認)
    const legacyRow = await prisma.aiObservation.findFirst({
      where: { diagnosisId: saved.diagnosisId, sourceType: "mock" },
    });
    expect(legacyRow).not.toBeNull();
  });

  it("CASE2 reference: provisional=true、citations=[]/competitorMentions=[]がnullへ変換されずに保存される", async () => {
    const deps = buildDeps(new FixedCanonicalAiMeasurementProvider(buildReferenceObservation));
    const result = await runFreeDiagnosis(buildInput("canonical CASE2歯科医院"), deps);
    const saved = await repo.saveDiagnosisResult(
      { clinicUrl: "https://example.com", contactEmail: "test@example.com" },
      result
    );

    const dbRow = await prisma.aiObservation.findFirst({
      where: { diagnosisId: saved.diagnosisId, provider: "openai", evidence: "integration test: CASE2 reference" },
    });
    expect(dbRow).not.toBeNull();
    expect(dbRow!.measurementStatus).toBe("reference");
    expect(dbRow!.provisional).toBe(true);
    expect(dbRow!.citationsJson).toBe("[]");
    expect(dbRow!.competitorsJson).toBe("[]");
    expect(dbRow!.citationsJson).not.toBeNull();
    expect(dbRow!.competitorsJson).not.toBeNull();
  });

  it("CASE3 unavailable: mention/rank/citationsJson/competitorsJsonがすべてNULLのまま保存され、measurementStatus/unavailableReason/provisionalが正しい", async () => {
    const deps = buildDeps(new FixedCanonicalAiMeasurementProvider(buildUnavailableObservation));
    const result = await runFreeDiagnosis(buildInput("canonical CASE3歯科医院"), deps);
    const saved = await repo.saveDiagnosisResult(
      { clinicUrl: "https://example.com", contactEmail: "test@example.com" },
      result
    );

    const dbRow = await prisma.aiObservation.findFirst({
      where: { diagnosisId: saved.diagnosisId, provider: "openai", evidence: "integration test: CASE3 unavailable" },
    });
    expect(dbRow).not.toBeNull();
    expect(dbRow!.mention).toBeNull();
    expect(dbRow!.rank).toBeNull();
    expect(dbRow!.citationsJson).toBeNull();
    expect(dbRow!.competitorsJson).toBeNull();
    expect(dbRow!.measurementStatus).toBe("unavailable");
    expect(dbRow!.unavailableReason).toBe("temporarily_unavailable");
    expect(dbRow!.provisional).toBe(false);
  });

  it("CASE4 invalid: domain invariant違反のcanonical観測はAiMeasurementInvariantViolationErrorで保存が拒否され、DBに一切書き込まれない", async () => {
    const deps = buildDeps(new FixedCanonicalAiMeasurementProvider(buildInvalidObservation));
    const result = await runFreeDiagnosis(buildInput("canonical CASE4歯科医院"), deps);
    // fixtureが実際にinvariant違反(unavailableなのにmentioned=false)を含むことを前提として確認
    expect(result.aiMeasurementObservations?.[0]?.measurementStatus).toBe("unavailable");
    expect(result.aiMeasurementObservations?.[0]?.mentioned).toBe(false);

    const clinicCountBefore = await prisma.clinic.count();
    const diagnosisCountBefore = await prisma.diagnosis.count();
    const observationCountBefore = await prisma.aiObservation.count();

    let caughtError: unknown;
    try {
      await repo.saveDiagnosisResult(
        { clinicUrl: "https://example.com", contactEmail: "test@example.com" },
        result
      );
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(AiMeasurementInvariantViolationError);

    // 「DBへ保存しない」ことの確認: legacy live拒否テストと同じ原則で、canonical観測の
    // validationもどのprisma書き込みよりも前に行うため、clinic/diagnosis/ai_observationsの
    // いずれも増えていない(legacy観測すら保存されない=部分的な保存を許さない)。
    expect(await prisma.clinic.count()).toBe(clinicCountBefore);
    expect(await prisma.diagnosis.count()).toBe(diagnosisCountBefore);
    expect(await prisma.aiObservation.count()).toBe(observationCountBefore);
  });
});
