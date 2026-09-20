import { describe, expect, it } from "vitest";

import {
  OpenAiMeasurementProvider,
  InvalidRequestedModelError,
  DuplicatePatientQuestionError,
} from "@/server/providers/ai-measurement/openai/openAiMeasurementProvider";
import { OPENAI_PROMPT_VERSION } from "@/server/providers/ai/openai/openAiPromptVersion";
import {
  FakeOpenAiMeasurementClient,
  measuredOutcome,
  referenceOutcome,
  failureOutcome,
} from "../fixtures/openai/fakeOpenAiMeasurementClient";
import {
  MEASUREMENT_PLAN,
  MeasurementPlanQuestionNotFoundError,
  type MeasurementPlan,
} from "@/domain/ai-measurement/measurementPlan";
import { validateAiMeasurementObservation } from "@/domain/ai-measurement/invariants";
import type { AiMeasurementObservationInput } from "@/domain/ai-measurement/provider";

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
 * OpenAiMeasurementProvider(Phase 2、2026-09-08のユーザー指示)のテスト。
 *
 * 実HTTP/SDKは一切呼ばない。client層は`FakeOpenAiMeasurementClient`
 * (質問文字列keyの決定的fake。Phase 1のcall順scriptedなfakeをそのまま使い回さない
 * 理由は同fixtureのJSDoc参照)で差し替える。
 *
 * 【2026-09-08の修正ラウンド】以前はここに「source file全文にMockAiProviderという
 * 文字列が存在しないこと」を検証するstatic grep testがあったが、JSDoc/comment内の
 * 説明文言(「MockAiProviderへfallbackしない」等)だけでfailする実装依存の脆いtest
 * だったため削除した。mock fallback禁止のcontract(API失敗→canonical unavailable
 * observation、mock/legacyへの置換なし)は、以下のbehavior test(8, 9, 10)で
 * measurementStatus/unavailableReason/sourceType/providerIdを直接検証することで
 * 保証する。
 *
 * また、以前存在した「observe()が返すobservations配列とtargetQuestionsの過不足を
 * 独自チェックするtest」も削除した。この責務は既存
 * `computeMeasurementCoverage()`(`MeasurementPlanExecutionMismatchError`、
 * measurementCoverage.tsは今回無変更)に一本化されている。
 *
 * 番号コメントはユーザー指示の必須test項目1〜28に対応する
 * (22番のみ、上記の理由によりbehavior testへ差し替えた)。
 */

const MODEL = "fake-openai-measurement-model";
const CLINIC_NAME = "OpenAiMeasurementProviderテスト歯科医院";
const CLINIC_URL = "https://example.com";
const FIXED_AT = "2026-01-01T00:00:00.000Z";

const TARGET_QUESTIONS = MEASUREMENT_PLAN.questions
  .filter((q) => q.targetProviders.includes("openai"))
  .map((q) => q.question);
const UNTARGETED_QUESTIONS = MEASUREMENT_PLAN.questions
  .filter((q) => q.targetProviders.length === 0)
  .map((q) => q.question);

function buildInput(
  overrides: Partial<AiMeasurementObservationInput> = {}
): AiMeasurementObservationInput {
  return {
    clinicName: CLINIC_NAME,
    clinicUrl: CLINIC_URL,
    patientQuestions: [...TARGET_QUESTIONS, ...UNTARGETED_QUESTIONS],
    competitors: [],
    ...overrides,
  };
}

describe("OpenAiMeasurementProvider: constructor", () => {
  it("requestedModelが空文字だとInvalidRequestedModelErrorをthrowする", () => {
    const client = new FakeOpenAiMeasurementClient({});
    expect(() => new OpenAiMeasurementProvider("", client)).toThrow(InvalidRequestedModelError);
  });

  it("requestedModelが空白のみだとInvalidRequestedModelErrorをthrowする", () => {
    const client = new FakeOpenAiMeasurementClient({});
    expect(() => new OpenAiMeasurementProvider("   ", client)).toThrow(InvalidRequestedModelError);
  });
});

describe("OpenAiMeasurementProvider: measurement plan対象選択(1-5)", () => {
  it("1. MEASUREMENT_PLANから対象質問を動的に抽出する(現行仕様では3問、questionテキストはhardcodeされていない)", async () => {
    expect(TARGET_QUESTIONS.length).toBe(3);
    const client = new FakeOpenAiMeasurementClient(
      Object.fromEntries(TARGET_QUESTIONS.map((q) => [q, measuredOutcome()]))
    );
    const provider = new OpenAiMeasurementProvider(MODEL, client);
    const observations = await provider.observe(buildInput());
    expect(observations).toHaveLength(TARGET_QUESTIONS.length);
    expect(observations.map((o) => o.question).sort()).toEqual([...TARGET_QUESTIONS].sort());
  });

  it("2. targetProviders=[]の質問はclient.fetch()を呼ばない", async () => {
    const client = new FakeOpenAiMeasurementClient(
      Object.fromEntries(TARGET_QUESTIONS.map((q) => [q, measuredOutcome()]))
    );
    const provider = new OpenAiMeasurementProvider(MODEL, client);
    await provider.observe(buildInput());
    for (const q of UNTARGETED_QUESTIONS) {
      expect(client.callCountFor(q)).toBe(0);
    }
  });

  it("3. 対象質問はplanから動的に決まる(質問文字列がprovider内にhardcodeされていないことをカスタムplanで確認)", async () => {
    const customPlan: MeasurementPlan = {
      planVersion: "test-plan@custom.1",
      questions: [
        { question: "カスタム質問A", targetProviders: ["openai"] },
        { question: "カスタム質問B", targetProviders: [] },
      ],
    };
    const client = new FakeOpenAiMeasurementClient({ "カスタム質問A": measuredOutcome() });
    const provider = new OpenAiMeasurementProvider(MODEL, client, { plan: customPlan });
    const observations = await provider.observe({
      clinicName: CLINIC_NAME,
      clinicUrl: CLINIC_URL,
      patientQuestions: ["カスタム質問A", "カスタム質問B"],
      competitors: [],
    });
    expect(observations.map((o) => o.question)).toEqual(["カスタム質問A"]);
    expect(client.callCountFor("カスタム質問B")).toBe(0);
  });

  it("4. 対象質問ごとにclient.fetch()がちょうど1回呼ばれる(1問1call、batch化しない)", async () => {
    const client = new FakeOpenAiMeasurementClient(
      Object.fromEntries(TARGET_QUESTIONS.map((q) => [q, measuredOutcome()]))
    );
    const provider = new OpenAiMeasurementProvider(MODEL, client);
    await provider.observe(buildInput());
    for (const q of TARGET_QUESTIONS) {
      expect(client.callCountFor(q)).toBe(1);
    }
  });

  it("5. 全対象質問が成功した場合、対象質問数と同じ件数のobservationsが返る", async () => {
    const client = new FakeOpenAiMeasurementClient(
      Object.fromEntries(TARGET_QUESTIONS.map((q) => [q, measuredOutcome()]))
    );
    const provider = new OpenAiMeasurementProvider(MODEL, client);
    const observations = await provider.observe(buildInput());
    expect(observations).toHaveLength(3);
  });
});

describe("OpenAiMeasurementProvider: measured/reference判定(6-7)", () => {
  it("6. web_search_callが存在する応答→measurementStatus='measured'", async () => {
    const q = TARGET_QUESTIONS[0]!;
    const client = new FakeOpenAiMeasurementClient({ [q]: measuredOutcome() });
    const provider = new OpenAiMeasurementProvider(MODEL, client);
    const [obs] = await provider.observe(buildInput({ patientQuestions: [q] }));
    expect(obs!.measurementStatus).toBe("measured");
  });

  it("7. web_search_callが存在しない応答→measurementStatus='reference'", async () => {
    const q = TARGET_QUESTIONS[0]!;
    const client = new FakeOpenAiMeasurementClient({ [q]: referenceOutcome() });
    const provider = new OpenAiMeasurementProvider(MODEL, client);
    const [obs] = await provider.observe(buildInput({ patientQuestions: [q] }));
    expect(obs!.measurementStatus).toBe("reference");
  });
});

describe("OpenAiMeasurementProvider: partial failure / mock fallback禁止のbehavior保証(8-10)", () => {
  it("8. 1問がtimeout失敗→その問いだけcanonical unavailable(mock/legacyへ置換されない)、他は正常、observe()はthrowしない", async () => {
    const [q1, q2, q3] = TARGET_QUESTIONS as [string, string, string];
    const client = new FakeOpenAiMeasurementClient({
      [q1]: measuredOutcome(),
      [q2]: failureOutcome("timeout", "fake timeout"),
      [q3]: referenceOutcome(),
    });
    const provider = new OpenAiMeasurementProvider(MODEL, client);
    const observations = await provider.observe(buildInput({ patientQuestions: [q1, q2, q3] }));
    expect(observations).toHaveLength(3);
    const failed = observations.find((o) => o.question === q2)!;
    // mock fallback禁止のcontract: API失敗でもsourceType/providerIdはcanonicalな
    // ai_provider/openaiのまま(mock/legacy観測へ差し替わっていないことを保証する)。
    expect(failed.sourceType).toBe("ai_provider");
    expect(failed.providerId).toBe("openai");
    expect(failed.measurementStatus).toBe("unavailable");
    expect(failed.unavailableReason).toBe("temporarily_unavailable");
    expect(observations.find((o) => o.question === q1)!.measurementStatus).toBe("measured");
    expect(observations.find((o) => o.question === q3)!.measurementStatus).toBe("reference");
  });

  it("9. 1問が429(rate_limited)失敗→その問いだけcanonical unavailable(mock/legacyへ置換されない)、他は継続する", async () => {
    const [q1, q2, q3] = TARGET_QUESTIONS as [string, string, string];
    const client = new FakeOpenAiMeasurementClient({
      [q1]: measuredOutcome(),
      [q2]: failureOutcome("rate_limited", "fake rate limited"),
      [q3]: referenceOutcome(),
    });
    const provider = new OpenAiMeasurementProvider(MODEL, client);
    const observations = await provider.observe(buildInput({ patientQuestions: [q1, q2, q3] }));
    const failed = observations.find((o) => o.question === q2)!;
    expect(failed.sourceType).toBe("ai_provider");
    expect(failed.providerId).toBe("openai");
    expect(failed.measurementStatus).toBe("unavailable");
    expect(failed.unavailableReason).toBe("temporarily_unavailable");
    expect(observations.find((o) => o.question === q1)!.measurementStatus).toBe("measured");
    expect(observations.find((o) => o.question === q3)!.measurementStatus).toBe("reference");
  });

  it("10. 対象質問すべてが失敗→3件ともcanonical unavailable(mock fallbackなし)、observe()自体は正常に解決する", async () => {
    const client = new FakeOpenAiMeasurementClient(
      Object.fromEntries(
        TARGET_QUESTIONS.map((q) => [q, failureOutcome("fetch_failed", "fake fetch failed")])
      )
    );
    const provider = new OpenAiMeasurementProvider(MODEL, client);
    const observations = await provider.observe(buildInput({ patientQuestions: TARGET_QUESTIONS }));
    expect(observations).toHaveLength(3);
    for (const o of observations) {
      // mock fallback禁止のcontract本体: API失敗は必ずcanonical
      // (sourceType="ai_provider", providerId="openai")なunavailable observationに
      // なり、legacy/mock observationへ置き換わることはない。
      expect(o.sourceType).toBe("ai_provider");
      expect(o.providerId).toBe("openai");
      expect(o.measurementStatus).toBe("unavailable");
      expect(o.unavailableReason).toBe("fetch_failed");
    }
  });
});

describe("OpenAiMeasurementProvider: promptと事後matchingの分離(11-14)", () => {
  it("11-13. promptにclinicName/clinicUrl/competitor名が一切含まれない", async () => {
    const q = TARGET_QUESTIONS[0]!;
    const client = new FakeOpenAiMeasurementClient({ [q]: measuredOutcome() });
    const provider = new OpenAiMeasurementProvider(MODEL, client);

    const distinctiveClinicName = "★特徴的な医院名株式会社XYZ★";
    const distinctiveUrl = "https://distinctive-clinic-xyz.example.com/very-specific-path";
    const distinctiveCompetitor = "★特徴的な競合クリニック名ABC★";
    const competitors: CompetitorClinic[] = [{ id: "c1", name: distinctiveCompetitor }];

    await provider.observe({
      clinicName: distinctiveClinicName,
      clinicUrl: distinctiveUrl,
      patientQuestions: [q],
      competitors,
    });

    expect(client.receivedDescriptors).toHaveLength(1);
    const serializedDescriptor = JSON.stringify(client.receivedDescriptors[0]);
    expect(serializedDescriptor).not.toContain(distinctiveClinicName);
    expect(serializedDescriptor).not.toContain(distinctiveUrl);
    expect(serializedDescriptor).not.toContain(distinctiveCompetitor);
  });

  it("14. clinicName/officialClinicUrlはadapterの事後matchingにのみ使われる(応答本文に医院名が出現すればmentioned=true)", async () => {
    const q = TARGET_QUESTIONS[0]!;
    const clinicName = "事後マッチング検証歯科医院";
    const client = new FakeOpenAiMeasurementClient({
      [q]: measuredOutcome({ text: `おすすめは${clinicName}です。` }),
    });
    const provider = new OpenAiMeasurementProvider(MODEL, client);
    const [obs] = await provider.observe({
      clinicName,
      clinicUrl: CLINIC_URL,
      patientQuestions: [q],
      competitors: [],
    });
    expect(obs!.mentioned).toBe(true);
  });
});

describe("OpenAiMeasurementProvider: meta伝播(15-20)", () => {
  it("15. requestedModelがすべてのdescriptorに渡される", async () => {
    const client = new FakeOpenAiMeasurementClient(
      Object.fromEntries(TARGET_QUESTIONS.map((q) => [q, measuredOutcome()]))
    );
    const provider = new OpenAiMeasurementProvider(MODEL, client);
    await provider.observe(buildInput({ patientQuestions: TARGET_QUESTIONS }));
    for (const d of client.receivedDescriptors) {
      expect(d.model).toBe(MODEL);
    }
  });

  it("16. すべてのobservationのmeasurementMeta.promptVersionが単一source of truthと一致する", async () => {
    const [q1, q2, q3] = TARGET_QUESTIONS as [string, string, string];
    const client = new FakeOpenAiMeasurementClient({
      [q1]: measuredOutcome(),
      [q2]: referenceOutcome(),
      [q3]: failureOutcome("timeout"),
    });
    const provider = new OpenAiMeasurementProvider(MODEL, client);
    const observations = await provider.observe(buildInput({ patientQuestions: [q1, q2, q3] }));
    for (const o of observations) {
      expect(o.measurementMeta?.promptVersion).toBe(OPENAI_PROMPT_VERSION);
    }
  });

  it("17-18. providerResponseId/usageは質問ごとに独立している", async () => {
    const [q1, q2] = TARGET_QUESTIONS as [string, string];
    const client = new FakeOpenAiMeasurementClient({
      [q1]: measuredOutcome({ id: "resp_q1_unique", usage: { input_tokens: 111, output_tokens: 222, total_tokens: 333 } }),
      [q2]: measuredOutcome({ id: "resp_q2_unique", usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 } }),
    });
    const provider = new OpenAiMeasurementProvider(MODEL, client);
    const observations = await provider.observe(buildInput({ patientQuestions: [q1, q2] }));
    const o1 = observations.find((o) => o.question === q1)!;
    const o2 = observations.find((o) => o.question === q2)!;
    expect(o1.measurementMeta?.providerResponseId).toBe("resp_q1_unique");
    expect(o2.measurementMeta?.providerResponseId).toBe("resp_q2_unique");
    expect(o1.measurementMeta?.providerResponseId).not.toBe(o2.measurementMeta?.providerResponseId);
    expect(o1.measurementMeta?.usage?.inputTokens).toBe(111);
    expect(o2.measurementMeta?.usage?.inputTokens).toBe(1);
  });

  it("19-20. sourceType='ai_provider'・providerId='openai'が設定される", async () => {
    const q = TARGET_QUESTIONS[0]!;
    const client = new FakeOpenAiMeasurementClient({ [q]: measuredOutcome() });
    const provider = new OpenAiMeasurementProvider(MODEL, client);
    const [obs] = await provider.observe(buildInput({ patientQuestions: [q] }));
    expect(obs!.sourceType).toBe("ai_provider");
    expect(obs!.providerId).toBe("openai");
  });
});

describe("OpenAiMeasurementProvider: invariants(21, 28)", () => {
  it("21. 返されるすべてのobservationがdomain invariantを満たす", async () => {
    const [q1, q2, q3] = TARGET_QUESTIONS as [string, string, string];
    const client = new FakeOpenAiMeasurementClient({
      [q1]: measuredOutcome(),
      [q2]: referenceOutcome(),
      [q3]: failureOutcome("fetch_failed"),
    });
    const provider = new OpenAiMeasurementProvider(MODEL, client);
    const observations = await provider.observe(buildInput({ patientQuestions: [q1, q2, q3] }));
    for (const o of observations) {
      expect(() => validateAiMeasurementObservation(o)).not.toThrow();
    }
  });

  it("28. raw responseに含まれる想定外のフィールドはobservationへ一切伝播しない", async () => {
    const q = TARGET_QUESTIONS[0]!;
    const outcome = measuredOutcome();
    if (outcome.ok) {
      (outcome.response as unknown as Record<string, unknown>).secretDebugInfo = "SHOULD_NEVER_LEAK";
    }
    const client = new FakeOpenAiMeasurementClient({ [q]: outcome });
    const provider = new OpenAiMeasurementProvider(MODEL, client);
    const [obs] = await provider.observe(buildInput({ patientQuestions: [q] }));
    expect(JSON.stringify(obs)).not.toContain("SHOULD_NEVER_LEAK");
  });
});

describe("OpenAiMeasurementProvider: patientQuestions整合チェック(23-25)", () => {
  it("23. MEASUREMENT_PLANに存在しない質問はMeasurementPlanQuestionNotFoundErrorをthrowする(silent ignoreしない)", async () => {
    const client = new FakeOpenAiMeasurementClient({});
    const provider = new OpenAiMeasurementProvider(MODEL, client);
    await expect(
      provider.observe(buildInput({ patientQuestions: ["MEASUREMENT_PLANに存在しない質問テキスト"] }))
    ).rejects.toThrow(MeasurementPlanQuestionNotFoundError);
  });

  it("24. patientQuestionsに重複があるとDuplicatePatientQuestionErrorをthrowする(重複実行しない)", async () => {
    const q = TARGET_QUESTIONS[0]!;
    const client = new FakeOpenAiMeasurementClient({ [q]: measuredOutcome() });
    const provider = new OpenAiMeasurementProvider(MODEL, client);
    await expect(
      provider.observe(buildInput({ patientQuestions: [q, q] }))
    ).rejects.toThrow(DuplicatePatientQuestionError);
  });

  it("25. patientQuestionsが空配列の場合、observe()はerrorにせず空配列を返す", async () => {
    const client = new FakeOpenAiMeasurementClient({});
    const provider = new OpenAiMeasurementProvider(MODEL, client);
    const observations = await provider.observe(buildInput({ patientQuestions: [] }));
    expect(observations).toEqual([]);
  });
});

describe("OpenAiMeasurementProvider: OPENAI_PROMPT_VERSIONは今回bumpしない(念のためのlock)", () => {
  it("29. OPENAI_PROMPT_VERSIONは引き続き'openai_patient_question_prompt_v2'のまま", () => {
    expect(OPENAI_PROMPT_VERSION).toBe("openai_patient_question_prompt_v2");
  });
});

// ---------------------------------------------------------------------------
// runFreeDiagnosisへの接続テスト(26-27)。production route.tsは一切変更しない。
// テストのみでdeps.aiMeasurementProviderへOpenAiMeasurementProvider(+fake client)
// を注入し、既存のcanonical status/root cause判定・scoring isolationが
// 従来どおり機能することを確認する。
// ---------------------------------------------------------------------------

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
  readonly name = "fake-competitor-provider-openai-provider-test";
  async findNearbyCompetitors(): Promise<CompetitorClinic[]> {
    return [];
  }
}

class FakeAdComplianceProvider implements AdComplianceProvider {
  readonly name = "fake-ad-compliance-provider-openai-provider-test";
  async check(_input: AdComplianceCheckInput): Promise<RawAdRiskFinding[]> {
    return [];
  }
}

class FakeScoreProvider implements ScoreProvider {
  readonly name = "fake-score-provider-openai-provider-test";
  async score(domain: DomainKey, _input: ScoreCriterionInput): Promise<CriterionScore[]> {
    return fullHealthCriteria(domain);
  }
}

class FakeLegacyAiProvider implements AiProvider {
  readonly name = "fake-legacy-ai-provider-openai-provider-test";
  async observe(input: AiObservationInput): Promise<AiObservationResult[]> {
    return input.patientQuestions.map((question) => ({
      question,
      aiProvider: "chatgpt",
      model: "fake-legacy-model",
      mentioned: true,
      recommendationRank: 1,
      competitorMentions: [],
      citations: [],
      region: null,
      evidence: "test: legacy evidence (openai measurement provider test)",
      dataSource: "mock",
      capturedAt: FIXED_AT,
    }));
  }
}

function buildRunFreeDiagnosisDeps(overrides: Partial<RunFreeDiagnosisDeps> = {}): RunFreeDiagnosisDeps {
  return {
    aiProvider: new FakeLegacyAiProvider(),
    competitorProvider: new FakeCompetitorProvider(),
    scoreProvider: new FakeScoreProvider(),
    adComplianceProvider: new FakeAdComplianceProvider(),
    ...overrides,
  };
}

const RUN_CLINIC_NAME = "openai runFreeDiagnosis接続検証歯科医院";
const RUN_INPUT = {
  clinicName: RUN_CLINIC_NAME,
  directorName: "テスト院長",
  clinicUrl: "https://example.com",
  contactEmail: "test@example.com",
  contactPhone: "03-1234-5678",
};

function buildScriptedOpenAiProvider(): OpenAiMeasurementProvider {
  const [q1, q2, q3] = TARGET_QUESTIONS as [string, string, string];
  const client = new FakeOpenAiMeasurementClient({
    // 医院名を含まないtext→mentioned=false→lose(既存root cause判定を経由する)
    [q1]: measuredOutcome(),
    [q2]: measuredOutcome({ text: `${RUN_CLINIC_NAME}が一番のおすすめです。` }),
    [q3]: measuredOutcome({ text: `${RUN_CLINIC_NAME}が一番のおすすめです。` }),
  });
  return new OpenAiMeasurementProvider(MODEL, client);
}

describe("runFreeDiagnosisへの接続(26-27、production route.tsは変更しない)", () => {
  it("26. OpenAiMeasurementProviderを注入してもcanonical status/root causeが正しく機能する", async () => {
    const openAiProvider = buildScriptedOpenAiProvider();
    const result = await runFreeDiagnosis(
      RUN_INPUT,
      buildRunFreeDiagnosisDeps({ aiMeasurementProvider: openAiProvider })
    );
    const primaryTargeted = TARGET_QUESTIONS[0]!;
    const target = result.questionResults.find((q) => q.question === primaryTargeted)!;
    expect(target.statusSource).toBe("canonical_measurement");
    expect(target.sourceType).toBe("canonical_measurement");
    expect(target.status).toBe("lose");
    expect(target.rootCauseKey).toBe("AIO:ai_search_presence");
  });

  it("27. 同一シナリオでscoreBreakdown/isSampleがcanonical measurement非接続時と変わらない(scoring isolation)", async () => {
    const openAiProvider = buildScriptedOpenAiProvider();

    const withoutProvider = await runFreeDiagnosis(RUN_INPUT, buildRunFreeDiagnosisDeps());
    const withProvider = await runFreeDiagnosis(
      RUN_INPUT,
      buildRunFreeDiagnosisDeps({ aiMeasurementProvider: openAiProvider })
    );

    expect(withProvider.scoreBreakdown).toEqual(withoutProvider.scoreBreakdown);
    expect(withProvider.isSample).toBe(withoutProvider.isSample);
  });
});
