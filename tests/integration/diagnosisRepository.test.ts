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
import { applyPrismaMigrationsToTestDatabase } from "../helpers/testDatabase";

/**
 * DiagnosisRepositoryの実DB(SQLite)結合テスト(2026-09-05のユーザー指示⑤)。
 *
 * Docker/Testcontainers等の大規模な新規基盤は導入しない。既存のPrisma+SQLite構成のまま、
 * OS一時ディレクトリに使い捨てのSQLiteファイルを作り、`prisma db push`でスキーマを
 * 適用してから実際にPrismaClient経由で読み書きする(Prismaが公式に案内している
 * SQLiteテスト用パターン)。テスト対象のprisma/schema.prismaに構文・関係の誤りがあれば
 * ここで`db push`自体が失敗するため、これ自体が簡易的なスキーマ検証にもなる。
 *
 * 重要: DATABASE_URLをテスト用パスへ差し替えてから`@/server/db/diagnosisRepository`と
 * `@/server/db/prismaClient`を動的import()する。静的importだとモジュール評価(=
 * `new PrismaClient()`の実行)がテストファイル先頭で即座に走ってしまい、beforeAllで
 * 設定するDATABASE_URLが間に合わない(通常の開発用dev.dbを見に行ってしまう)ため。
 */

let testDbDir: string;
let repo: typeof import("@/server/db/diagnosisRepository");
let duplicateRepo: typeof import("@/server/db/clinicDuplicateRepository");
let billingRepo: typeof import("@/server/db/billingRepository");
let prisma: import("@prisma/client").PrismaClient;

beforeAll(async () => {
  // macOSではPrisma schema engineが`/var/folders/...`配下を使えない制限環境がある。
  // OSの一時領域である`/tmp`の実体パスへ寄せ、通常環境ではtmpdir()を使う。
  const testTmpRoot =
    process.platform === "darwin" ? realpathSync("/tmp") : realpathSync(tmpdir());
  testDbDir = mkdtempSync(path.join(testTmpRoot, "dent-shift-test-db-"));
  const testDbPath = path.join(testDbDir, "test.db");
  process.env.DATABASE_URL = `file:${testDbPath}`;

  // vitestは常にリポジトリルート(package.jsonのある場所、"test": "vitest run"の実行場所)を
  // cwdとして起動されるため、__dirnameに依存せずprocess.cwd()を使う
  // (ESM/CJSどちらの変換設定でも安定して動く)。
  applyPrismaMigrationsToTestDatabase(testDbPath);

  repo = await import("@/server/db/diagnosisRepository");
  duplicateRepo = await import("@/server/db/clinicDuplicateRepository");
  billingRepo = await import("@/server/db/billingRepository");
  const clientModule = await import("@/server/db/prismaClient");
  prisma = clientModule.prisma;
}, 60000);

afterAll(async () => {
  await prisma?.$disconnect();
  if (testDbDir) rmSync(testDbDir, { recursive: true, force: true });
});

// --- 最小限のfakeプロバイダー(このファイル専用。他のtestファイルの private classと重複するが、
// 各テストファイルが自己完結する既存の方針を踏襲する) ---

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
  readonly name = "integration-fake-score-provider";
  async score(domain: DomainKey, _input: ScoreCriterionInput): Promise<CriterionScore[]> {
    return mockCriteria(domain);
  }
}

/**
 * mock由来1件・live由来1件を混在させるfixture。
 * 2026-09-07のユーザー指示(Phase 2直前対応)により、dataSource==="live"の観測は
 * saveDiagnosisResult()がLegacyLiveAiObservationErrorをthrowして保存を拒否するように
 * なったため、このproviderはもう「一般的な往復テスト用の共通deps」には使わず、
 * その拒否挙動そのものを検証する専用テストでのみ使用する。
 */
class LegacyLiveMixedAiProvider implements AiProvider {
  readonly name = "integration-fake-ai-provider-legacy-live-mixed";
  async observe(input: AiObservationInput): Promise<AiObservationResult[]> {
    return input.patientQuestions.slice(0, 2).map((question, i) => ({
      question,
      aiProvider: i === 0 ? "chatgpt" : "gemini",
      model: i === 0 ? "mock-model" : "live-model",
      mentioned: true,
      recommendationRank: i === 0 ? 1 : null,
      competitorMentions: i === 0 ? ["競合A"] : [],
      citations: i === 0 ? [] : ["https://example.com/citation"],
      region: i === 0 ? null : "tokyo",
      evidence: `integration test evidence ${i}`,
      dataSource: i === 0 ? "mock" : "live",
      capturedAt: `2026-01-01T00:00:0${i}.000Z`,
    }));
  }
}

/**
 * 2026-09-07のユーザー指示(Phase 2直前対応)により、一般的な往復テスト用の共通deps
 * (adComplianceChecks/isSample/テナント分離等、AI観測のsourceType種別そのものが
 * 検証対象ではないテスト群)はlive観測を含められなくなったため、
 * LegacyLiveMixedAiProviderと同じ2件・同じフィールドの差(citations/region/
 * recommendationRank/competitorMentions)を持たせつつ、両方ともdataSource="mock"にした
 * fixtureへ置き換える。
 */
class TwoMockAiProvider implements AiProvider {
  readonly name = "integration-fake-ai-provider-two-mock";
  async observe(input: AiObservationInput): Promise<AiObservationResult[]> {
    return input.patientQuestions.slice(0, 2).map((question, i) => ({
      question,
      aiProvider: i === 0 ? "chatgpt" : "gemini",
      model: i === 0 ? "mock-model" : "mock-model-2",
      mentioned: true,
      recommendationRank: i === 0 ? 1 : null,
      competitorMentions: i === 0 ? ["競合A"] : [],
      citations: i === 0 ? [] : ["https://example.com/citation"],
      region: i === 0 ? null : "tokyo",
      evidence: `integration test evidence ${i}`,
      dataSource: "mock" as const,
      capturedAt: `2026-01-01T00:00:0${i}.000Z`,
    }));
  }
}

/**
 * 2026-09-07(Phase 1書き込み側対応、ユーザー指示): mock providerが生成した観測を保存した際、
 * measurementStatus/unavailableReason/measurementMetaJson/provisionalが正しい値になり、
 * かつcitations=[]/competitorMentions=[]がnullへ変換されず"測定して0件"のまま保存・復元
 * されることを検証するための、citations/competitorsが両方とも空配列のmock専用provider。
 */
class MockOnlyEmptyArraysAiProvider implements AiProvider {
  readonly name = "integration-fake-ai-provider-mock-only-empty-arrays";
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
        evidence: "integration test: citations/competitorsが両方とも0件のmock観測",
        dataSource: "mock",
        capturedAt: "2026-01-01T00:00:00.000Z",
      },
    ];
  }
}

class EmptyCompetitorProvider implements CompetitorProvider {
  readonly name = "integration-fake-competitor-provider";
  async findNearbyCompetitors(): Promise<CompetitorClinic[]> {
    return [];
  }
}

/** mock由来1件・非mock(rule_based)由来1件を混在させる。 */
class MixedAdComplianceProvider implements AdComplianceProvider {
  readonly name = "integration-fake-ad-compliance-provider";
  async check(_input: AdComplianceCheckInput): Promise<RawAdRiskFinding[]> {
    return [
      {
        category: "safety_assertion",
        severity: "high",
        matchStrength: "direct",
        quotedText: "integration test: 実測所見",
        sourceLocation: "トップページ",
        detectionReason: "integration test",
        sourceType: "rule_based",
      },
      {
        category: "review_incentive",
        severity: "high",
        matchStrength: "direct",
        quotedText: "integration test: mock所見",
        sourceLocation: "口コミ投稿案内ページ",
        detectionReason: "integration test",
        sourceType: "mock",
      },
    ];
  }
}

const deps: RunFreeDiagnosisDeps = {
  aiProvider: new TwoMockAiProvider(),
  competitorProvider: new EmptyCompetitorProvider(),
  scoreProvider: new FakeScoreProvider(),
  adComplianceProvider: new MixedAdComplianceProvider(),
};

/**
 * 2026-09-07のユーザー指示(Phase 2直前対応): legacy live観測がsaveDiagnosisResult()で
 * 明示的に保存拒否されることを検証する専用deps。
 */
const depsWithLegacyLive: RunFreeDiagnosisDeps = {
  ...deps,
  aiProvider: new LegacyLiveMixedAiProvider(),
};

/** MEOのみunavailable(permission_required)にし、他domainは通常のmockCriteriaを返す
 * (2026-09-06のユーザー指示④: unavailableReasonの永続化検証用)。 */
class UnavailableMeoScoreProvider implements ScoreProvider {
  readonly name = "integration-fake-score-provider-unavailable-meo";
  async score(domain: DomainKey, _input: ScoreCriterionInput): Promise<CriterionScore[]> {
    if (domain !== "MEO") return mockCriteria(domain);
    return DOMAIN_CRITERIA.MEO.map((def) => ({
      key: def.key,
      label: def.label,
      maxScore: def.maxScore,
      score: null,
      status: "unavailable",
      evidence: [{ summary: "integration test: 権限不足のため測定不能" }],
      measuredAt: null,
      dataSource: "mock",
      unavailableReason: "permission_required",
    }));
  }
}

const depsWithUnavailableMeo: RunFreeDiagnosisDeps = {
  ...deps,
  scoreProvider: new UnavailableMeoScoreProvider(),
};

/**
 * 最初の質問のみ「負け」(自院は言及されず、競合が言及される)にし、2問目は言及ありにする。
 * 残り4問は観測なし(insufficient_data)のまま。
 * 「なぜ負けている?」root cause属性(questionResultsJson内の追加フィールド)が実DB経由でも
 * 失われないことを検証するためのフィクスチャ(2026-09-06のユーザー指示)。
 * 2026-09-07のユーザー指示(Phase 2直前対応)により、2問目もdataSource="mock"にした
 * (live観測はsaveDiagnosisResult()が保存拒否するようになったため、root cause検証という
 * 本来の目的に無関係なlive混在は解消する)。
 */
class MixedWithLosingQuestionAiProvider implements AiProvider {
  readonly name = "integration-fake-ai-provider-mixed-with-losing-question";
  async observe(input: AiObservationInput): Promise<AiObservationResult[]> {
    const [first, second] = input.patientQuestions;
    const results: AiObservationResult[] = [];
    if (first) {
      results.push({
        question: first,
        aiProvider: "chatgpt",
        model: "mock-model",
        mentioned: false,
        recommendationRank: null,
        competitorMentions: ["競合クリニックA"],
        citations: [],
        region: null,
        evidence: "integration test: 競合のみ言及された",
        dataSource: "mock",
        capturedAt: "2026-01-01T00:00:00.000Z",
      });
    }
    if (second) {
      results.push({
        question: second,
        aiProvider: "gemini",
        model: "mock-model-2",
        mentioned: true,
        recommendationRank: 1,
        competitorMentions: [],
        citations: ["https://example.com/citation"],
        region: "tokyo",
        evidence: "integration test: 自院が言及された",
        dataSource: "mock",
        capturedAt: "2026-01-01T00:00:01.000Z",
      });
    }
    return results;
  }
}

const depsWithLosingQuestion: RunFreeDiagnosisDeps = {
  ...deps,
  aiProvider: new MixedWithLosingQuestionAiProvider(),
};

const depsWithMockOnlyEmptyArrays: RunFreeDiagnosisDeps = {
  ...deps,
  aiProvider: new MockOnlyEmptyArraysAiProvider(),
};

function buildInput(clinicName: string): RunFreeDiagnosisInput {
  return {
    clinicName,
    clinicUrl: "https://example.com",
    contactEmail: "test@example.com",
    contactPhone: "03-1234-5678",
  };
}

describe("DiagnosisRepository: 保存/取得のラウンドトリップ(2026-09-05のユーザー指示⑤)", () => {
  it("adComplianceChecksのsourceType/provisional/severity/confidence/evidence/escalationEligibleが保存後も失われない", async () => {
    const result = await runFreeDiagnosis(buildInput("ラウンドトリップ歯科医院"), deps);
    const saved = await repo.saveDiagnosisResult({ clinicUrl: "https://example.com", contactEmail: "test@example.com" }, result);
    const fetched = await repo.getDiagnosisById(saved.diagnosisId);

    expect(fetched).not.toBeNull();
    expect(fetched!.adComplianceChecks.findings.length).toBe(result.adComplianceChecks.findings.length);
    for (const original of result.adComplianceChecks.findings) {
      const restored = fetched!.adComplianceChecks.findings.find((f) => f.id === original.id)!;
      expect(restored).toBeDefined();
      expect(restored.sourceType).toBe(original.sourceType);
      expect(restored.provisional).toBe(original.provisional);
      expect(restored.severity).toBe(original.severity);
      expect(restored.confidence).toBe(original.confidence);
      expect(restored.escalationEligible).toBe(original.escalationEligible);
      expect(restored.evidence).toEqual(original.evidence);
    }
    // mock由来とrule_based由来が両方とも取得できている(=どちらかが欠落していない)
    expect(fetched!.adComplianceChecks.findings.some((f) => f.sourceType === "mock")).toBe(true);
    expect(fetched!.adComplianceChecks.findings.some((f) => f.sourceType === "rule_based")).toBe(true);
  });

  it("isSampleが保存され、取得時も一覧(getDiagnosesByClinicId)でも判別できる", async () => {
    const result = await runFreeDiagnosis(buildInput("isSample検証歯科医院"), deps);
    expect(result.isSample).toBe(true); // FakeScoreProviderがmock criteriaを返すため
    const saved = await repo.saveDiagnosisResult({ clinicUrl: "https://example.com", contactEmail: "test@example.com" }, result);
    const fetched = await repo.getDiagnosisById(saved.diagnosisId);
    expect(fetched!.isSample).toBe(true);

    const list = await repo.getDiagnosesByClinicId(saved.clinicId);
    expect(list.length).toBe(1);
    expect(list[0]!.isSample).toBe(true);
  });

  it("ai_observationsが診断単位・質問単位で保存され、citations/region/recommendationRank/competitorMentionsが行ごとに正しく区別される(2026-09-07のユーザー指示、Phase 2直前対応: live観測はもう保存できないためTwoMockAiProviderのmock2件で区別を検証する)", async () => {
    const result = await runFreeDiagnosis(buildInput("AI観測検証歯科医院"), deps);
    const saved = await repo.saveDiagnosisResult({ clinicUrl: "https://example.com", contactEmail: "test@example.com" }, result);
    const fetched = await repo.getDiagnosisById(saved.diagnosisId);

    expect(fetched!.aiObservations.length).toBe(result.aiObservations.length);
    // TwoMockAiProviderは2件とも dataSource="mock" を返すため、両方とも
    // sourceType="mock" / provisional=true になる(2026-09-07以降の仕様どおり)。
    expect(fetched!.aiObservations.every((o) => o.sourceType === "mock")).toBe(true);
    expect(fetched!.aiObservations.every((o) => o.provisional === true)).toBe(true);

    const firstRow = fetched!.aiObservations.find((o) => o.recommendationRank === 1)!;
    expect(firstRow).toBeDefined();
    expect(firstRow.citations).toEqual([]);
    expect(firstRow.region).toBeNull();
    expect(firstRow.competitorMentions).toEqual(["競合A"]);

    const secondRow = fetched!.aiObservations.find((o) => o.recommendationRank === null)!;
    expect(secondRow).toBeDefined();
    expect(secondRow.citations).toEqual(["https://example.com/citation"]);
    expect(secondRow.region).toBe("tokyo");
    expect(secondRow.competitorMentions).toEqual([]);
  });

  it("mock observationはsourceType/measurementStatus/unavailableReason/measurementMetaJson/provisionalが正しく保存され、citations=[]/competitors=[]がnullへ変換されずに保存・復元される(2026-09-07のユーザー指示、Phase 1書き込み側対応)", async () => {
    const result = await runFreeDiagnosis(buildInput("Phase1書き込み検証歯科医院"), depsWithMockOnlyEmptyArrays);
    const saved = await repo.saveDiagnosisResult(
      { clinicUrl: "https://example.com", contactEmail: "test@example.com" },
      result
    );
    const fetched = await repo.getDiagnosisById(saved.diagnosisId);
    expect(fetched).not.toBeNull();
    expect(fetched!.aiObservations.length).toBe(1);

    const row = fetched!.aiObservations[0]!;
    expect(row.sourceType).toBe("mock");
    expect(row.measurementStatus).toBe("reference");
    expect(row.unavailableReason).toBeNull();
    expect(row.measurementMetaJson).toBeNull();
    expect(row.provisional).toBe(true);

    // citations=[]/competitorMentions=[]は「未測定(null)」ではなく「測定して0件([])」として
    // 保存・復元される(docs/AI_MEASUREMENT_PROVIDER_DESIGN_2026-09-07.md「SQL NULL=未測定、
    // []=測定して0件」の区別を、mockの正常系でも壊さないことの確認)。
    expect(row.citations).toEqual([]);
    expect(row.citations).not.toBeNull();
    expect(row.competitorMentions).toEqual([]);
    expect(row.competitorMentions).not.toBeNull();

    // DB上も直接確認する(mapAiObservationRow経由の変換だけに依存しない二重チェック)。
    const dbRow = await prisma.aiObservation.findFirst({
      where: { diagnosisId: saved.diagnosisId },
    });
    expect(dbRow).not.toBeNull();
    expect(dbRow!.sourceType).toBe("mock");
    expect(dbRow!.measurementStatus).toBe("reference");
    expect(dbRow!.unavailableReason).toBeNull();
    expect(dbRow!.measurementMetaJson).toBeNull();
    expect(dbRow!.provisional).toBe(true);
    expect(dbRow!.citationsJson).toBe("[]");
    expect(dbRow!.competitorsJson).toBe("[]");
  });

  it("unavailableReason(criterion/questionResult/dataGap)が保存後も失われない(2026-09-06のユーザー指示④)", async () => {
    const result = await runFreeDiagnosis(buildInput("理由保持検証歯科医院"), depsWithUnavailableMeo);
    const saved = await repo.saveDiagnosisResult(
      { clinicUrl: "https://example.com", contactEmail: "test@example.com" },
      result
    );
    const fetched = await repo.getDiagnosisById(saved.diagnosisId);
    expect(fetched).not.toBeNull();

    // criterion単位: MEOはpermission_requiredとしてJSON保存・復元される(scoreBreakdownJson経由)
    const meoDomain = fetched!.scoreBreakdown.domains.find((d: { domain: string }) => d.domain === "MEO");
    expect(meoDomain.status).toBe("unavailable");
    for (const c of meoDomain.criteria) {
      expect(c.unavailableReason).toBe("permission_required");
      expect(c.score).toBeNull(); // 権限不足を0点として扱わない
    }
    // 他domainは正常(measured/estimated)なのでunavailableReasonは付かない
    const seoDomain = fetched!.scoreBreakdown.domains.find((d: { domain: string }) => d.domain === "SEO");
    for (const c of seoDomain.criteria) {
      expect(c.unavailableReason).toBeNull();
    }

    // 質問結果単位: TwoMockAiProviderは最初の2問のみ観測を返すため、残りはinsufficient_dataとして
    // questionResultsJson経由で保存・復元される
    const insufficientQuestions = fetched!.questionResults.filter(
      (q: { status: string }) => q.status === "insufficient_data"
    );
    expect(insufficientQuestions.length).toBeGreaterThan(0);
    for (const q of insufficientQuestions) {
      expect(q.unavailableReason).toBe("insufficient_data");
    }
    const answeredQuestions = fetched!.questionResults.filter(
      (q: { status: string }) => q.status !== "insufficient_data"
    );
    expect(answeredQuestions.length).toBeGreaterThan(0);
    for (const q of answeredQuestions) {
      expect(q.unavailableReason).toBeNull();
    }

    // data_gap候補単位: 根拠criterionのunavailableReasonがimprovementTasksJson経由でも失われない
    const meoGap = fetched!.topImprovements.find((c: { key: string }) => c.key === "data-gap-MEO");
    expect(meoGap?.dataGap?.unavailableReason).toBe("permission_required");
  });

  it("「なぜ負けている?」root cause属性(questionResultsJson内の追加フィールド)が保存後も失われない(2026-09-06のユーザー指示)", async () => {
    const result = await runFreeDiagnosis(buildInput("root cause永続化検証歯科医院"), depsWithLosingQuestion);
    const losing = result.questionResults.find((q) => q.status === "lose");
    expect(losing).toBeDefined();
    expect(losing!.attributionStatus).toBe("attributed");
    expect(losing!.rootCauseKey).toBe("AIO:ai_search_presence");

    const saved = await repo.saveDiagnosisResult(
      { clinicUrl: "https://example.com", contactEmail: "test@example.com" },
      result
    );
    const fetched = await repo.getDiagnosisById(saved.diagnosisId);
    expect(fetched).not.toBeNull();

    const restoredLosing = fetched!.questionResults.find(
      (q: { question: string }) => q.question === losing!.question
    );
    expect(restoredLosing).toBeDefined();
    expect(restoredLosing.status).toBe("lose");
    expect(restoredLosing.attributionStatus).toBe("attributed");
    expect(restoredLosing.rootCauseKey).toBe("AIO:ai_search_presence");
    expect(restoredLosing.rootCauseLabel).toBe(losing!.rootCauseLabel);
    expect(restoredLosing.confidence).toBe(losing!.confidence);
    expect(restoredLosing.sourceType).toBe("mock");
    expect(restoredLosing.provisional).toBe(true);
    expect(restoredLosing.competitorDifference).toEqual(["競合クリニックA"]);
    expect(restoredLosing.analysisVersion).toBe(losing!.analysisVersion);

    // win/insufficient_dataの質問はnot_applicableのまま保存・復元される
    const restoredNonLosing = fetched!.questionResults.filter(
      (q: { status: string }) => q.status !== "lose"
    );
    expect(restoredNonLosing.length).toBeGreaterThan(0);
    for (const q of restoredNonLosing) {
      expect(q.attributionStatus).toBe("not_applicable");
      expect(q.rootCauseKey).toBeNull();
    }
  });
});

describe("DiagnosisRepository: clinic_id テナント分離(SECURITY.md「テナント分離の実装方針」)", () => {
  it("ログイン中の再診断は既存Clinicへ追加され、新しいClinicを作らない", async () => {
    const clinic = await prisma.clinic.create({
      data: {
        name: "再診断対象歯科医院",
        url: "https://repeat.example.com",
      },
    });
    const clinicCountBefore = await prisma.clinic.count();

    const firstResult = await runFreeDiagnosis(buildInput("再診断1回目歯科医院"), deps);
    const secondResult = await runFreeDiagnosis(buildInput("再診断2回目歯科医院"), deps);
    const first = await repo.saveDiagnosisResult(
      {
        clinicUrl: "https://repeat.example.com",
        contactEmail: "repeat@example.com",
        existingClinicId: clinic.id,
      },
      firstResult
    );
    const second = await repo.saveDiagnosisResult(
      {
        clinicUrl: "https://repeat.example.com",
        contactEmail: "repeat@example.com",
        existingClinicId: clinic.id,
      },
      secondResult
    );

    expect(first.clinicId).toBe(clinic.id);
    expect(second.clinicId).toBe(clinic.id);
    expect(await prisma.clinic.count()).toBe(clinicCountBefore);

    const history = await repo.getDiagnosesByClinicId(clinic.id);
    expect(history.map((diagnosis) => diagnosis.id)).toEqual(
      expect.arrayContaining([first.diagnosisId, second.diagnosisId])
    );
    const observations = await prisma.aiObservation.findMany({
      where: { diagnosisId: { in: [first.diagnosisId, second.diagnosisId] } },
    });
    expect(observations.length).toBeGreaterThan(0);
    expect(observations.every((observation) => observation.clinicId === clinic.id)).toBe(true);
  });

  it("匿名診断の代表メールアドレスと電話番号をClinicへ保存する", async () => {
    const result = await runFreeDiagnosis(buildInput("メール保存確認歯科医院"), deps);
    const saved = await repo.saveDiagnosisResult(
      {
        clinicUrl: "https://mail-save.example.com",
        contactEmail: "clinic@example.com",
        contactPhone: "03-1234-5678",
      },
      result
    );

    const clinic = await prisma.clinic.findUnique({ where: { id: saved.clinicId } });
    expect(clinic?.contactEmail).toBe("clinic@example.com");
    expect(clinic?.contactPhone).toBe("03-1234-5678");
  });

  it("結果メールの送信状態と送信日時を診断へ保存する", async () => {
    const result = await runFreeDiagnosis(buildInput("メール状態保存確認歯科医院"), deps);
    const saved = await repo.saveDiagnosisResult(
      {
        clinicUrl: "https://mail-status.example.com",
        contactEmail: "clinic@example.com",
        contactPhone: "03-1234-5678",
      },
      result
    );

    const before = await repo.getDiagnosisById(saved.diagnosisId);
    expect(before?.resultEmailStatus).toBe("pending");
    expect(before?.resultEmailSentAt).toBeNull();

    await repo.updateDiagnosisResultEmailStatus(saved.diagnosisId, "sent");
    const after = await repo.getDiagnosisById(saved.diagnosisId);
    expect(after?.resultEmailStatus).toBe("sent");
    expect(after?.resultEmailSentAt).toBeInstanceOf(Date);
  });

  it("存在しないセッション由来Clinicでは診断データを一切作成しない", async () => {
    const result = await runFreeDiagnosis(buildInput("存在しない医院への再診断"), deps);
    const clinicCountBefore = await prisma.clinic.count();
    const diagnosisCountBefore = await prisma.diagnosis.count();
    const observationCountBefore = await prisma.aiObservation.count();

    await expect(
      repo.saveDiagnosisResult(
        {
          clinicUrl: "https://missing.example.com",
          contactEmail: "missing@example.com",
          existingClinicId: "missing-clinic-id",
        },
        result
      )
    ).rejects.toBeInstanceOf(repo.ExistingClinicNotFoundError);

    expect(await prisma.clinic.count()).toBe(clinicCountBefore);
    expect(await prisma.diagnosis.count()).toBe(diagnosisCountBefore);
    expect(await prisma.aiObservation.count()).toBe(observationCountBefore);
  });

  it("getDiagnosesByClinicIdは自院以外の診断を返さない", async () => {
    const resultA = await runFreeDiagnosis(buildInput("テナントA歯科医院"), deps);
    const resultB = await runFreeDiagnosis(buildInput("テナントB歯科医院"), deps);
    const savedA = await repo.saveDiagnosisResult({ clinicUrl: "https://a.example.com", contactEmail: "a@example.com" }, resultA);
    const savedB = await repo.saveDiagnosisResult({ clinicUrl: "https://b.example.com", contactEmail: "b@example.com" }, resultB);

    const listA = await repo.getDiagnosesByClinicId(savedA.clinicId);
    const listB = await repo.getDiagnosesByClinicId(savedB.clinicId);

    expect(listA.map((d) => d.id)).toContain(savedA.diagnosisId);
    expect(listA.map((d) => d.id)).not.toContain(savedB.diagnosisId);
    expect(listB.map((d) => d.id)).toContain(savedB.diagnosisId);
    expect(listB.map((d) => d.id)).not.toContain(savedA.diagnosisId);
  });

  it("ai_observationsのclinicIdが正しく設定され、他院のclinicIdで検索しても混ざらない", async () => {
    const resultA = await runFreeDiagnosis(buildInput("AI観測テナントA歯科医院"), deps);
    const resultB = await runFreeDiagnosis(buildInput("AI観測テナントB歯科医院"), deps);
    const savedA = await repo.saveDiagnosisResult({ clinicUrl: "https://a2.example.com", contactEmail: "a2@example.com" }, resultA);
    const savedB = await repo.saveDiagnosisResult({ clinicUrl: "https://b2.example.com", contactEmail: "b2@example.com" }, resultB);

    const rowsA = await prisma.aiObservation.findMany({ where: { clinicId: savedA.clinicId } });
    const rowsB = await prisma.aiObservation.findMany({ where: { clinicId: savedB.clinicId } });

    expect(rowsA.length).toBeGreaterThan(0);
    expect(rowsB.length).toBeGreaterThan(0);
    expect(rowsA.every((r) => r.clinicId === savedA.clinicId)).toBe(true);
    expect(rowsB.every((r) => r.clinicId === savedB.clinicId)).toBe(true);
    expect(rowsA.some((r) => r.diagnosisId === savedB.diagnosisId)).toBe(false);
  });
});

describe("ClinicDuplicateRepository: P0重複候補検出", () => {
  it("DB上のClinicから完全URL一致とドメイン一致を検出する", async () => {
    const clinic = await prisma.clinic.create({
      data: {
        name: "重複検出結合テスト歯科",
        url: "https://www.integration-duplicate.example.jp/clinic/",
      },
    });

    await expect(
      duplicateRepo.findClinicDuplicateCandidate({
        clinicName: "別名でもURL一致",
        clinicUrl: "http://integration-duplicate.example.jp/clinic?source=test",
      })
    ).resolves.toEqual({ clinicId: clinic.id, matchType: "exact_url" });

    await expect(
      duplicateRepo.findClinicDuplicateCandidate({
        clinicName: "別名でもドメイン一致",
        clinicUrl: "https://integration-duplicate.example.jp/treatment",
      })
    ).resolves.toEqual({ clinicId: clinic.id, matchType: "same_domain" });
  });
});

describe("DiagnosisRepository: Phase 2(measurementStatus NOT NULL化)直前の書き込み側検証(2026-09-07のユーザー指示)", () => {
  it("mock observationはmeasurementStatus='reference'として正常に保存される", async () => {
    const result = await runFreeDiagnosis(
      buildInput("Phase2書き込み確認歯科医院"),
      depsWithMockOnlyEmptyArrays
    );
    const saved = await repo.saveDiagnosisResult(
      { clinicUrl: "https://example.com", contactEmail: "test@example.com" },
      result
    );
    const fetched = await repo.getDiagnosisById(saved.diagnosisId);
    expect(fetched).not.toBeNull();
    expect(fetched!.aiObservations.length).toBe(1);
    expect(fetched!.aiObservations[0]!.sourceType).toBe("mock");
    expect(fetched!.aiObservations[0]!.measurementStatus).toBe("reference");
  });

  it("legacy live observation(dataSource='live')はmeasurementStatusを推測せず、LegacyLiveAiObservationErrorで保存が拒否され、DBに一切書き込まれない", async () => {
    const result = await runFreeDiagnosis(buildInput("Legacy live拒否確認歯科医院"), depsWithLegacyLive);
    // LegacyLiveMixedAiProviderが実際にlive観測を1件含んでいることを前提として確認しておく
    expect(result.aiObservations.some((o) => o.dataSource === "live")).toBe(true);

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

    expect(caughtError).toBeInstanceOf(repo.LegacyLiveAiObservationError);
    expect((caughtError as Error).message).toBe(
      "Legacy live AiObservation cannot be persisted without explicit measurementStatus"
    );

    // 「DBへ保存しない」ことの確認: clinic/diagnosis/ai_observationsのいずれも増えていない
    // (measurementStatusの決定・拒否をどのprisma書き込みよりも前に行っているため、
    // 例外発生時にorphanなclinic行が残らないことも合わせて検証する)。
    expect(await prisma.clinic.count()).toBe(clinicCountBefore);
    expect(await prisma.diagnosis.count()).toBe(diagnosisCountBefore);
    expect(await prisma.aiObservation.count()).toBe(observationCountBefore);
  });
});

describe("BillingRepository: 契約状態の医院スコープ", () => {
  it("同じ医院の契約だけを取得・遷移し、他院IDでは変更できない", async () => {
    const clinic = await prisma.clinic.create({
      data: { name: "契約状態確認歯科", url: "https://billing.example.com" },
    });
    const otherClinic = await prisma.clinic.create({
      data: { name: "別医院", url: "https://other-billing.example.com" },
    });
    const subscription = await billingRepo.createSubscriptionRecord({
      clinicId: clinic.id,
      plan: "standard",
      status: "trial",
      externalSubscriptionId: "sub_test_standard",
    });

    expect(await billingRepo.getLatestSubscriptionByClinicId(clinic.id)).toEqual(
      expect.objectContaining({ id: subscription.id, plan: "standard", status: "trial" })
    );
    await billingRepo.transitionSubscriptionStatus({
      clinicId: clinic.id,
      subscriptionId: subscription.id,
      to: "active",
    });
    expect((await billingRepo.getLatestSubscriptionByClinicId(clinic.id))?.status).toBe("active");

    await expect(
      billingRepo.transitionSubscriptionStatus({
        clinicId: otherClinic.id,
        subscriptionId: subscription.id,
        to: "cancelled",
      })
    ).rejects.toBeInstanceOf(billingRepo.BillingRepositoryStateError);
  });

  it("Stripe通知を成功・失敗へ反映し、同じ通知は二重処理しない", async () => {
    const clinic = await prisma.clinic.create({
      data: { name: "通知テスト歯科", url: "https://webhook.example.com" },
    });
    const checkoutAt = new Date("2026-09-10T01:00:00.000Z");
    const paidAt = new Date("2026-09-10T01:01:00.000Z");

    expect(
      await billingRepo.applyBillingWebhookEvent({
        providerEventId: "evt_checkout_unique",
        eventType: "checkout.session.completed",
        occurredAt: checkoutAt,
        action: {
          kind: "checkout_completed",
          identity: {
            externalSubscriptionId: "sub_webhook_unique",
            clinicId: clinic.id,
            plan: "premium",
          },
          initialStatus: "trial",
        },
      })
    ).toBe("processed");

    const paidCommand = {
      providerEventId: "evt_paid_unique",
      eventType: "invoice.paid",
      occurredAt: paidAt,
      action: {
        kind: "invoice_status" as const,
        identity: {
          externalSubscriptionId: "sub_webhook_unique",
          clinicId: clinic.id,
          plan: "premium" as const,
        },
        status: "active" as const,
        paymentStatus: "paid" as const,
        externalPaymentId: "in_paid_unique",
      },
    };
    expect(await billingRepo.applyBillingWebhookEvent(paidCommand)).toBe("processed");
    expect(await billingRepo.applyBillingWebhookEvent(paidCommand)).toBe("duplicate");

    expect((await billingRepo.getLatestSubscriptionByClinicId(clinic.id))?.status).toBe("active");
    expect(await prisma.payment.count({ where: { externalPaymentId: "in_paid_unique" } })).toBe(1);
    expect(
      await prisma.billingWebhookEvent.count({
        where: { providerEventId: { in: ["evt_checkout_unique", "evt_paid_unique"] } },
      })
    ).toBe(2);
  });

  it("同じ契約の初回通知が重なっても契約レコードを一つだけ作る", async () => {
    const clinic = await prisma.clinic.create({
      data: { name: "同時通知テスト歯科", url: "https://webhook-race.example.com" },
    });
    const identity = {
      externalSubscriptionId: "sub_webhook_race_unique",
      clinicId: clinic.id,
      plan: "standard" as const,
    };

    const results = await Promise.all([
      billingRepo.applyBillingWebhookEvent({
        providerEventId: "evt_checkout_race_unique",
        eventType: "checkout.session.completed",
        occurredAt: new Date("2026-09-10T04:00:00.000Z"),
        action: { kind: "checkout_completed", identity, initialStatus: "active" },
      }),
      billingRepo.applyBillingWebhookEvent({
        providerEventId: "evt_subscription_race_unique",
        eventType: "customer.subscription.created",
        occurredAt: new Date("2026-09-10T04:00:00.000Z"),
        action: { kind: "subscription_status", identity, status: "active" },
      }),
    ]);

    expect(results).toEqual(["processed", "processed"]);
    expect(
      await prisma.subscription.count({
        where: { externalSubscriptionId: "sub_webhook_race_unique" },
      })
    ).toBe(1);
    expect(
      await prisma.billingWebhookEvent.count({
        where: {
          providerEventId: {
            in: ["evt_checkout_race_unique", "evt_subscription_race_unique"],
          },
        },
      })
    ).toBe(2);
  });

  it("古い支払い失敗通知と医院ID不一致で正しい契約を上書きしない", async () => {
    const clinic = await prisma.clinic.create({
      data: { name: "順序確認歯科", url: "https://event-order.example.com" },
    });
    const otherClinic = await prisma.clinic.create({
      data: { name: "通知別医院", url: "https://event-other.example.com" },
    });
    await billingRepo.applyBillingWebhookEvent({
      providerEventId: "evt_newer_paid",
      eventType: "invoice.paid",
      occurredAt: new Date("2026-09-10T02:00:00.000Z"),
      action: {
        kind: "invoice_status",
        identity: {
          externalSubscriptionId: "sub_order_unique",
          clinicId: clinic.id,
          plan: "standard",
        },
        status: "active",
        paymentStatus: "paid",
        externalPaymentId: "in_newer_paid",
      },
    });
    await billingRepo.applyBillingWebhookEvent({
      providerEventId: "evt_older_failed",
      eventType: "invoice.payment_failed",
      occurredAt: new Date("2026-09-10T01:00:00.000Z"),
      action: {
        kind: "invoice_status",
        identity: {
          externalSubscriptionId: "sub_order_unique",
          clinicId: clinic.id,
          plan: "standard",
        },
        status: "past_due",
        paymentStatus: "failed",
        externalPaymentId: "in_older_failed",
      },
    });
    expect((await billingRepo.getLatestSubscriptionByClinicId(clinic.id))?.status).toBe("active");

    await expect(
      billingRepo.applyBillingWebhookEvent({
        providerEventId: "evt_wrong_clinic",
        eventType: "customer.subscription.updated",
        occurredAt: new Date("2026-09-10T03:00:00.000Z"),
        action: {
          kind: "subscription_status",
          identity: {
            externalSubscriptionId: "sub_order_unique",
            clinicId: otherClinic.id,
            plan: "standard",
          },
          status: "cancelled",
        },
      })
    ).rejects.toBeInstanceOf(billingRepo.BillingRepositoryStateError);
    expect((await billingRepo.getLatestSubscriptionByClinicId(clinic.id))?.status).toBe("active");
    expect(
      await prisma.billingWebhookEvent.count({ where: { providerEventId: "evt_wrong_clinic" } })
    ).toBe(0);
  });
});
