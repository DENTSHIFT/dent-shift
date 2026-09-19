import { describe, expect, it } from "vitest";
import { createAiMeasurementProviderFromConfig } from "@/server/composition/aiMeasurementProviderFactory";
import { OpenAiMeasurementProvider } from "@/server/providers/ai-measurement/openai/openAiMeasurementProvider";
import type { AiMeasurementConfig } from "@/server/config/aiMeasurementConfig";
import {
  FakeOpenAiResponsesTransport,
  successResult,
  timeoutResult,
} from "../fixtures/openai/fakeOpenAiResponsesTransport";
import { MEASUREMENT_PLAN } from "@/domain/ai-measurement/measurementPlan";

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

/**
 * createAiMeasurementProviderFromConfig(Phase 3、composition root接続、
 * 2026-09-08のユーザー指示)のテスト。
 *
 * 実SDK transport(OpenAiSdkTransport)は実ネットワークを伴うため、composition層の
 * テストではPhase 1のFakeOpenAiResponsesTransportを`overrides.transport`経由で
 * 注入する(実SDKへの依存を持ち込まない)。
 *
 * 番号コメントはユーザー指示の必須test項目23〜27に対応する。
 */

const FIXED_MODEL = "fake-openai-model-for-factory-test";

describe("createAiMeasurementProviderFromConfig", () => {
  it("23. provider='mock' → aiMeasurementProviderはundefined", () => {
    const config: AiMeasurementConfig = { provider: "mock" };
    const provider = createAiMeasurementProviderFromConfig(config);
    expect(provider).toBeUndefined();
  });

  it("24. provider='openai' → OpenAiMeasurementProviderが構築される", () => {
    const config: AiMeasurementConfig = {
      provider: "openai",
      apiKey: "sk-test-key",
      model: FIXED_MODEL,
      timeoutMs: 15000,
      maxAttempts: 2,
    };
    const fakeTransport = new FakeOpenAiResponsesTransport([successResult()]);
    const provider = createAiMeasurementProviderFromConfig(config, { transport: fakeTransport });
    expect(provider).toBeInstanceOf(OpenAiMeasurementProvider);
    expect(provider?.name).toBe("openai-measurement-provider");
  });
});

// ---------------------------------------------------------------------------
// legacy mock共存・API failure時の非fallback・scoring isolation(25-27)。
// production route.tsは変更しない(このテストはfactory + runFreeDiagnosisの
// 直接呼び出しのみで検証する)。
// ---------------------------------------------------------------------------

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
  readonly name = "fake-competitor-provider-factory-test";
  async findNearbyCompetitors(): Promise<CompetitorClinic[]> {
    return [];
  }
}

class FakeAdComplianceProvider implements AdComplianceProvider {
  readonly name = "fake-ad-compliance-provider-factory-test";
  async check(_input: AdComplianceCheckInput): Promise<RawAdRiskFinding[]> {
    return [];
  }
}

class FakeScoreProvider implements ScoreProvider {
  readonly name = "fake-score-provider-factory-test";
  async score(domain: DomainKey, _input: ScoreCriterionInput): Promise<CriterionScore[]> {
    return fullHealthCriteria(domain);
  }
}

let legacyObserveCallCount = 0;
class CountingFakeLegacyAiProvider implements AiProvider {
  readonly name = "counting-fake-legacy-ai-provider-factory-test";
  async observe(input: AiObservationInput): Promise<AiObservationResult[]> {
    legacyObserveCallCount += 1;
    return input.patientQuestions.map((question) => ({
      question,
      aiProvider: "chatgpt",
      model: "fake-legacy-model",
      mentioned: true,
      recommendationRank: 1,
      competitorMentions: [],
      citations: [],
      region: null,
      evidence: "test: legacy evidence (factory test)",
      dataSource: "mock",
      capturedAt: FIXED_AT,
    }));
  }
}

function buildRunFreeDiagnosisDeps(overrides: Partial<RunFreeDiagnosisDeps> = {}): RunFreeDiagnosisDeps {
  return {
    aiProvider: new CountingFakeLegacyAiProvider(),
    competitorProvider: new FakeCompetitorProvider(),
    scoreProvider: new FakeScoreProvider(),
    adComplianceProvider: new FakeAdComplianceProvider(),
    ...overrides,
  };
}

const RUN_INPUT = {
  clinicName: "factory接続検証歯科医院",
  clinicUrl: "https://example.com",
  contactEmail: "test@example.com",
  contactPhone: "03-1234-5678",
};

describe("legacy mock共存 / API failure時の非fallback / scoring isolation(25-27)", () => {
  it("25. legacy aiProviderはmock modeでもopenai modeでも既存どおり呼ばれる", async () => {
    legacyObserveCallCount = 0;

    // mock mode: aiMeasurementProvider=undefined
    const mockModeProvider = createAiMeasurementProviderFromConfig({ provider: "mock" });
    await runFreeDiagnosis(
      RUN_INPUT,
      buildRunFreeDiagnosisDeps({ aiMeasurementProvider: mockModeProvider })
    );
    expect(legacyObserveCallCount).toBe(1);

    // openai mode: aiMeasurementProvider=OpenAiMeasurementProvider(fake transport全問成功)
    const fakeTransport = new FakeOpenAiResponsesTransport([successResult()]);
    const openaiModeProvider = createAiMeasurementProviderFromConfig(
      { provider: "openai", apiKey: "sk-test-key", model: FIXED_MODEL, timeoutMs: 15000, maxAttempts: 2 },
      { transport: fakeTransport }
    );
    await runFreeDiagnosis(
      RUN_INPUT,
      buildRunFreeDiagnosisDeps({ aiMeasurementProvider: openaiModeProvider })
    );
    expect(legacyObserveCallCount).toBe(2);
  });

  it("26. openai modeでAPI(transport)が全滅してもlegacy mockへfallbackしない(canonical unavailableのまま)", async () => {
    // 全対象質問でtimeout → OpenAiResponsesClientのretryを使い切っても最終的に
    // 失敗する(FakeOpenAiResponsesTransportは同じ結果を返し続けるscript)。
    const fakeTransport = new FakeOpenAiResponsesTransport([timeoutResult()]);
    const openaiModeProvider = createAiMeasurementProviderFromConfig(
      { provider: "openai", apiKey: "sk-test-key", model: FIXED_MODEL, timeoutMs: 15000, maxAttempts: 2 },
      { transport: fakeTransport }
    );
    const result = await runFreeDiagnosis(
      RUN_INPUT,
      buildRunFreeDiagnosisDeps({ aiMeasurementProvider: openaiModeProvider })
    );

    const targetedQuestions = MEASUREMENT_PLAN.questions
      .filter((q) => q.targetProviders.includes("openai"))
      .map((q) => q.question);
    for (const question of targetedQuestions) {
      const q = result.questionResults.find((r) => r.question === question)!;
      // canonical measurementが有効な質問はstatusSource="canonical_measurement"の
      // ままであり(legacy_referenceへ差し替わらない)、mock fallbackが一切
      // 起きていないことを確認する。全問unavailable(measuredCanonicalObservations
      // が空)のため、status/unavailableReasonは"insufficient_data"になる
      // (legacyのmentioned判定によるwin/close/loseへは絶対に落ちない。
      // computeCanonicalQuestionStatus内のmeasuredProviders===0→無条件
      // insufficient_data、という既存ルールの帰結)。
      expect(q.statusSource).toBe("canonical_measurement");
      expect(q.status).toBe("insufficient_data");
      expect(q.unavailableReason).toBe("insufficient_data");
    }
  });

  it("27. 同一シナリオでscoreBreakdown/isSampleがmock mode(canonical measurement非接続)時と変わらない(scoring isolation)", async () => {
    const withoutProvider = await runFreeDiagnosis(
      RUN_INPUT,
      buildRunFreeDiagnosisDeps({ aiMeasurementProvider: undefined })
    );

    const fakeTransport = new FakeOpenAiResponsesTransport([successResult()]);
    const openaiModeProvider = createAiMeasurementProviderFromConfig(
      { provider: "openai", apiKey: "sk-test-key", model: FIXED_MODEL, timeoutMs: 15000, maxAttempts: 2 },
      { transport: fakeTransport }
    );
    const withProvider = await runFreeDiagnosis(
      RUN_INPUT,
      buildRunFreeDiagnosisDeps({ aiMeasurementProvider: openaiModeProvider })
    );

    expect(withProvider.scoreBreakdown).toEqual(withoutProvider.scoreBreakdown);
    expect(withProvider.isSample).toBe(withoutProvider.isSample);
  });
});

// ---------------------------------------------------------------------------
// 30. raw SDK response全文をDB保存しないことについて:
// 既存のcanonical persistence(src/server/db/diagnosisRepository.ts、
// tests/unit/aiMeasurementCanonicalPersistence.test.ts、
// tests/unit/diagnosisRepositoryMeasurementStatus.test.ts、いずれも過去ラウンドで
// 確定・テスト済み)は、observation.measurementMetaのJSON化のみを保存し、raw
// response本体を一切保存しない設計であり、Phase 3ではこの永続化コード自体に
// 変更を加えていない。そのためこのファイルでは重複テストを追加せず、既存
// テストスイートへ委ねる。
// ---------------------------------------------------------------------------
