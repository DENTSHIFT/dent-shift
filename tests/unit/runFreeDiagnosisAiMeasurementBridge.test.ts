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
  AiObservationFieldProvenance,
} from "@/domain/ai-measurement/types";
import type {
  AiMeasurementObservationInput,
  AiMeasurementProvider,
} from "@/domain/ai-measurement/provider";
import { MEASUREMENT_PLAN } from "@/domain/ai-measurement/measurementPlan";
import type { PatientQuestionResult } from "@/domain/competitor/types";

/**
 * 「APIなしのcanonical persistence bridge」(2026-09-07のユーザー指示)の、
 * runFreeDiagnosisへの配線を検証するunit test。
 *
 * 2026-09-08の後続ラウンド(win/close/lose本接続、Mac実機テストでのfail報告)注記:
 * このファイルは元々「aiMeasurementProviderを追加してもquestionResults.statusは常に
 * 一致する」という、canonical status本接続前(加算的bridgeのみ)の前提でtestを書いていた。
 * その後の本接続ラウンドで、MEASUREMENT_PLAN対象質問(targetProviders.length > 0)は
 * canonical観測でstatusを判定する仕様に変わったため、その前提はobsoleteになった
 * (production側の実装はこの変更が正しい仕様であり、変更しない)。このファイルの責務を
 * 以下へ更新する:
 *
 * 目的: deps.aiMeasurementProviderが
 * (a) 未指定のとき、既存mock診断の挙動(scoreBreakdown/questionResults/aiObservations/
 *     isSample)が一切変わらないこと
 * (b) 指定されたとき、その結果がresult.aiMeasurementObservationsへそのまま配線されること
 * (c) scoreBreakdown/aiObservations/isSampleにはcanonical観測が混ざらないこと
 *     (これらは今回もscoring/root cause変更なしのため無変更)
 * (d) MEASUREMENT_PLAN対象外の質問(targetProviders.length === 0)のquestionResultsは、
 *     canonical providerの有無にかかわらずlegacy判定のまま変わらないこと
 *     (=canonical status接続が対象外質問へ波及していないことの保証)
 * (e) MEASUREMENT_PLAN対象質問(targetProviders.length > 0)は、canonical観測に基づき
 *     status/statusSource/measurementCoverage/evidenceが変わってよいこと(意図された仕様)
 * を確認する。canonical観測の内容自体(measurementStatus/measurementMetaの妥当性等)は
 * aiMeasurementInvariants.test.ts / openAiAdapter.test.ts で、win/close/lose判定の
 * 詳細な仕様(measured/reference/unavailableの扱い等)はcanonicalQuestionStatus.test.ts /
 * runFreeDiagnosisCanonicalStatusBridge.test.tsで個別に検証済みのため、ここでは
 * (a)〜(e)の配線・非波及の確認のみを対象にする。
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

function unavailableFieldProvenance(): AiObservationFieldProvenance {
  const cell = { measurementStatus: "unavailable" as const, derivation: null };
  return { mentioned: cell, recommendationRank: cell, citations: cell, competitorMentions: cell };
}

/**
 * わざと legacy provider と矛盾する内容(全質問 unavailable = 自院言及ですら判定不能)を返す
 * canonical provider。
 * 2026-09-08時点の仕様: MEASUREMENT_PLAN対象質問についてはmeasuredProviders===0となり、
 * canonical判定でinsufficient_dataになることが意図された挙動(legacyのwin判定には
 * fallbackしない)。scoreBreakdown/aiObservations/isSampleへ混ざっていないこと、および
 * plan対象外の質問がFullHealthAiProvider(全問win想定)のまま変わらないことで、
 * scoring/legacy win-lose判定へは混ざっていないことを検証する。
 */
class AllUnavailableFakeAiMeasurementProvider implements AiMeasurementProvider {
  readonly name = "fake-ai-measurement-provider-all-unavailable";
  public lastInput: AiMeasurementObservationInput | null = null;

  async observe(input: AiMeasurementObservationInput): Promise<AiMeasurementObservation[]> {
    this.lastInput = input;
    return input.patientQuestions.map((question) => ({
      question,
      providerId: "openai",
      model: "fake-canonical-model",
      sourceType: "ai_provider",
      measurementStatus: "unavailable",
      mentioned: null,
      recommendationRank: null,
      citations: null,
      competitorMentions: null,
      region: null,
      evidence: "test: canonical provider error",
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
      capturedAt: FIXED_AT,
    }));
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
  clinicName: "ブリッジ検証歯科医院",
  directorName: "テスト院長",
  clinicUrl: "https://example.com",
  contactEmail: "test@example.com",
  contactPhone: "03-1234-5678",
};

describe("runFreeDiagnosis: canonical AiMeasurementProviderの加算的配線", () => {
  it("aiMeasurementProviderが未指定のとき、aiMeasurementObservationsはundefinedのままで、既存のresult形状は変わらない", async () => {
    const result = await runFreeDiagnosis(INPUT, buildDeps());
    expect(result.aiMeasurementObservations).toBeUndefined();
    // 既存のmock診断が従来どおり動くことの最小確認(全質問で自院言及=win)
    expect(result.questionResults.every((q) => q.status === "win")).toBe(true);
    expect(result.isSample).toBe(true);
  });

  it("aiMeasurementProviderが指定されたとき、result.aiMeasurementObservationsへそのまま配線され、canonical status接続対象外の既存結果を不必要に壊さない", async () => {
    // 全質問unavailableのcanonical providerを使う(=measuredProviders===0を必ず引き起こす
    // ケース)。MEASUREMENT_PLAN対象質問はこれによりinsufficient_dataへ変わることが
    // 意図された仕様であり(runFreeDiagnosisCanonicalStatusBridge.test.tsで詳細検証済み)、
    // このテストでは「対象質問だけが変わり、対象外質問・scoring・root cause・isSampleは
    // 変わらない」という配線範囲の正しさを確認する。
    const baseline = await runFreeDiagnosis(INPUT, buildDeps());
    const fakeMeasurementProvider = new AllUnavailableFakeAiMeasurementProvider();
    const withBridge = await runFreeDiagnosis(
      INPUT,
      buildDeps({ aiMeasurementProvider: fakeMeasurementProvider })
    );

    // 1. aiMeasurementObservations: providerの結果がそのまま配線されること(従来どおり維持)
    expect(withBridge.aiMeasurementObservations).toBeDefined();
    expect(withBridge.aiMeasurementObservations!.length).toBe(
      fakeMeasurementProvider.lastInput!.patientQuestions.length
    );
    expect(withBridge.aiMeasurementObservations!.length).toBeGreaterThan(0);
    expect(
      withBridge.aiMeasurementObservations!.every((o) => o.measurementStatus === "unavailable")
    ).toBe(true);

    // 2. scoreBreakdown: 今回canonical status接続ではscoring未変更のため完全一致を維持
    expect(withBridge.scoreBreakdown).toEqual(baseline.scoreBreakdown);

    // 3. aiObservations: legacy aiObservations自体は変更されていないことを維持
    expect(withBridge.aiObservations).toEqual(baseline.aiObservations);

    // 4. isSample: computeIsSampleは未変更のため一致を維持
    expect(withBridge.isSample).toBe(baseline.isSample);

    // 5. questionResults: 全体のstatus完全一致は要求しない。plan対象/対象外で分けて検証する
    // (質問名をこのファイルへ再ハードコードせず、MEASUREMENT_PLANを直接参照する)。
    const targetedQuestions = MEASUREMENT_PLAN.questions
      .filter((q) => q.targetProviders.length > 0)
      .map((q) => q.question);
    const untargetedQuestions = MEASUREMENT_PLAN.questions
      .filter((q) => q.targetProviders.length === 0)
      .map((q) => q.question);
    expect(targetedQuestions.length).toBeGreaterThan(0);
    expect(untargetedQuestions.length).toBeGreaterThan(0);

    const findResult = (results: PatientQuestionResult[], question: string) => {
      const found = results.find((q) => q.question === question);
      if (!found) throw new Error(`question not found in results: ${question}`);
      return found;
    };

    // ■ plan対象質問: canonical observationに基づきstatusが変化してよい
    // (今回は全問unavailable=measuredProviders===0のため、意図された仕様どおり
    // insufficient_dataになる。baselineとのstatus一致は要求しない)。
    for (const question of targetedQuestions) {
      const before = findResult(baseline.questionResults, question);
      const after = findResult(withBridge.questionResults, question);
      expect(after.measurementCoverage?.totalProviders).toBeGreaterThan(0);
      expect(after.statusSource).toBe("canonical_measurement");
      expect(after.status).toBe("insufficient_data");
      expect(before.statusSource).toBe("legacy_reference");

      // 6. status/statusSource/measurementCoverage/evidence/unavailableReason以外の
      // 既存フィールドは、canonical status接続で意図せず変化していないこと
      // (root cause属性はstatus==="lose"のときのみ実値を持つが、beforeは"win"・
      // afterは"insufficient_data"でどちらも非lose のためNOT_APPLICABLE_LOSS_ATTRIBUTION
      // で一致するはず)。
      expect(after.question).toBe(before.question);
      expect(after.competitorDifference).toEqual(before.competitorDifference);
      expect(after.rootCauseKey).toBe(before.rootCauseKey);
      expect(after.rootCauseLabel).toBe(before.rootCauseLabel);
      expect(after.confidence).toBe(before.confidence);
      expect(after.sourceType).toBe(before.sourceType);
      expect(after.provisional).toBe(before.provisional);
      expect(after.attributionStatus).toBe(before.attributionStatus);
      expect(after.analysisVersion).toBe(before.analysisVersion);
    }

    // ■ plan対象外質問: canonical status接続が波及していないことを保証する。
    // evidenceを含め、measurementCoverage以外の全フィールドがbaselineと完全一致する
    // (この質問はlegacy判定のまま、statusSourceも"legacy_reference"のまま)。
    for (const question of untargetedQuestions) {
      const before = findResult(baseline.questionResults, question);
      const after = findResult(withBridge.questionResults, question);
      expect(after.statusSource).toBe("legacy_reference");
      expect(after.status).toBe(before.status);
      const { measurementCoverage: _beforeCoverage, ...beforeRest } = before;
      const { measurementCoverage: _afterCoverage, ...afterRest } = after;
      expect(afterRest).toEqual(beforeRest);
    }
  });

  it("aiMeasurementProvider.observe()には、legacy aiProvider.observe()と同じclinicName/clinicUrl/patientQuestions/competitorsが渡される", async () => {
    const fakeMeasurementProvider = new AllUnavailableFakeAiMeasurementProvider();
    await runFreeDiagnosis(INPUT, buildDeps({ aiMeasurementProvider: fakeMeasurementProvider }));

    expect(fakeMeasurementProvider.lastInput).not.toBeNull();
    expect(fakeMeasurementProvider.lastInput!.clinicName).toBe(INPUT.clinicName);
    expect(fakeMeasurementProvider.lastInput!.clinicUrl).toBe(INPUT.clinicUrl);
    expect(fakeMeasurementProvider.lastInput!.patientQuestions.length).toBeGreaterThan(0);
    expect(Array.isArray(fakeMeasurementProvider.lastInput!.competitors)).toBe(true);
  });
});
