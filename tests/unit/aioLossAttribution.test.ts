import { describe, expect, it } from "vitest";
import {
  AIO_LOSS_ATTRIBUTION_LOGIC_VERSION,
  aggregateAioLossRootCauses,
  attributeQuestionLoss,
} from "@/domain/competitor/aioLossAttribution";
import type { PatientQuestionResult } from "@/domain/competitor/types";

/**
 * 「なぜ負けている?」root cause判定ロジック(2026-09-06のユーザー指示、および同日の
 * 追加ユーザー指示①②)のunit test。
 * P0でjudging evidenceから機械的に判定可能なのは AIO:ai_search_presence のみであり
 * (AIO:citation_acquisitionは、競合のcitation/link獲得を直接確認できる構造化signalが
 * 現在のAiObservationResult/AiMeasurementObservationいずれにも存在しないため到達不能。
 * 下記コメント参照)、この点を中心に検証する。
 *
 * 2026-09-08のユーザー指示(canonical measured loseのroot cause本接続ラウンド)により、
 * attributeQuestionLoss()が直接受け取る`LossAttributionObservationInput`の
 * `dataSource: "mock"|"live"`は`sourceType: "mock"|"canonical_measurement"`へ改名された
 * (legacy語彙"live"を退役し、canonical語彙"canonical_measurement"へ統一)。この関数自体は
 * legacy/canonicalどちらの証拠源から呼ばれるかを一切区別しない中立な判定ロジックであり、
 * このファイルの各テストで使う"canonical_measurement"というsourceType値は、実際には
 * legacy側の呼び出し元(mapLegacyForLossAttribution)経由でも、canonical側の呼び出し元
 * (mapCanonicalMeasuredForLossAttribution)経由でも到達しうる。呼び出し元による経路の
 * 使い分け自体はrunFreeDiagnosisCanonicalRootCauseBridge.test.tsで検証する。
 */

describe("attributeQuestionLoss(質問単位のevidence-first attribution)", () => {
  it("競合がcompetitorMentionsに現れるだけでは、AIO:citation_acquisitionにはならない(2026-09-06の追加ユーザー指示①)", () => {
    // 競合への「言及」と競合の「citation/link獲得」は別signalであり、現在のAiObservationResult
    // には競合側のcitation/link有無を示すフィールドが存在しないため、competitorMentionsの
    // 有無だけからcitation_acquisitionを推測してはならない。自院が言及されていない事実は
    // judging evidence上で直接確認できるため、AIO:ai_search_presenceに帰着する。
    const result = attributeQuestionLoss([
      { mentioned: false, competitorMentions: ["競合クリニックA"], sourceType: "canonical_measurement" },
    ]);
    expect(result.rootCauseKey).not.toBe("AIO:citation_acquisition");
    expect(result.rootCauseKey).toBe("AIO:ai_search_presence");
    expect(result.confidence).toBe("medium");
    expect(result.attributionStatus).toBe("attributed");
    expect(result.sourceType).toBe("canonical_measurement");
    expect(result.provisional).toBe(false);
    // competitorDifferenceは表示・traceability用としては維持される(判定には使わない)
    expect(result.competitorDifference).toEqual(["競合クリニックA"]);
  });

  // 【AIO:citation_acquisitionについて(2026-09-06の追加ユーザー指示①)】
  // citation_acquisitionへattributionしてよいのは、「競合にcitation/linkがある」かつ
  // 「自院にはcitation/linkが無い」ことを構造化データから直接確認できる場合のみである。
  // 現在のLossAttributionObservationInput(AiObservationResult)には、競合側・自院側の
  // citation/link有無を示すフィールドが存在しないため、P0ではAIO:citation_acquisitionを
  // 生成できるsignalが無い。ユーザー指示により、生成できないものを無理に生成するテストは
  // 書かず、「現行型では到達不能である」ことをここに明記するに留める(将来、citation/link
  // 構造化フィールドが追加された時点で、このrootCauseKeyへの到達テストを追加すること)。

  it("競合も自院も言及されていない場合、AIO:ai_search_presence・confidence=mediumになる", () => {
    const result = attributeQuestionLoss([
      { mentioned: false, competitorMentions: [], sourceType: "canonical_measurement" },
    ]);
    expect(result.rootCauseKey).toBe("AIO:ai_search_presence");
    expect(result.confidence).toBe("medium");
    expect(result.attributionStatus).toBe("attributed");
  });

  it("competitorMentionsの重複競合名はdedupされてcompetitorDifferenceに入る(表示・traceability用)", () => {
    const result = attributeQuestionLoss([
      { mentioned: false, competitorMentions: ["競合A", "競合B"], sourceType: "canonical_measurement" },
      { mentioned: false, competitorMentions: ["競合A"], sourceType: "canonical_measurement" },
    ]);
    expect(result.competitorDifference).toEqual(["競合A", "競合B"]);
  });

  it("mockのみの場合、provisional=trueになりhigh confidenceにはならない", () => {
    const result = attributeQuestionLoss([
      { mentioned: false, competitorMentions: ["競合A"], sourceType: "mock" },
    ]);
    expect(result.provisional).toBe(true);
    expect(result.sourceType).toBe("mock");
    expect(result.confidence).not.toBe("high");
    expect(result.confidence).toBe("medium");
  });

  it("real+mockが混在する場合、non-mock(real)のevidenceのみで判定される(2026-09-06の追加ユーザー指示②)", () => {
    const realOnly = attributeQuestionLoss([
      { mentioned: false, competitorMentions: [], sourceType: "canonical_measurement" },
    ]);
    const realPlusMock = attributeQuestionLoss([
      { mentioned: false, competitorMentions: [], sourceType: "canonical_measurement" },
      // mockは「自院が言及されている」という矛盾したevidenceを持つが、real evidenceが
      // 存在する限りmockは判定から完全に除外されるため、結果に影響してはならない。
      { mentioned: true, competitorMentions: [], sourceType: "mock" },
    ]);
    expect(realPlusMock.rootCauseKey).toBe(realOnly.rootCauseKey);
    expect(realPlusMock.attributionStatus).toBe(realOnly.attributionStatus);
    expect(realPlusMock.confidence).toBe(realOnly.confidence);
    expect(realPlusMock.provisional).toBe(false);
    expect(realPlusMock.sourceType).toBe("canonical_measurement");
  });

  it("real+mockでmockが強いsignal(競合への複数言及)を持っていても、confidenceは上昇しない", () => {
    const result = attributeQuestionLoss([
      { mentioned: false, competitorMentions: [], sourceType: "canonical_measurement" },
      { mentioned: false, competitorMentions: ["競合A", "競合B"], sourceType: "mock" },
    ]);
    expect(result.rootCauseKey).toBe("AIO:ai_search_presence");
    expect(result.confidence).toBe("medium");
    expect(result.confidence).not.toBe("high");
    expect(result.provisional).toBe(false);
    expect(result.sourceType).toBe("canonical_measurement");
    // competitorDifferenceは表示用としてmock側の競合名も含めて集計される(判定には不使用)
    expect(result.competitorDifference).toEqual(["競合A", "競合B"]);
  });

  it("real+mockというだけの理由でreal側のconfidenceが不当に低下しない", () => {
    const realOnly = attributeQuestionLoss([
      { mentioned: false, competitorMentions: [], sourceType: "canonical_measurement" },
    ]);
    const realPlusMock = attributeQuestionLoss([
      { mentioned: false, competitorMentions: [], sourceType: "canonical_measurement" },
      { mentioned: false, competitorMentions: [], sourceType: "mock" },
    ]);
    expect(realPlusMock.confidence).toBe(realOnly.confidence);
    expect(realPlusMock.provisional).toBe(realOnly.provisional);
    expect(realPlusMock.sourceType).toBe(realOnly.sourceType);
  });

  it("観測が1件も無い場合、原因を捏造せずinsufficient_evidenceを返す", () => {
    const result = attributeQuestionLoss([]);
    expect(result.attributionStatus).toBe("insufficient_evidence");
    expect(result.rootCauseKey).toBeNull();
    expect(result.rootCauseLabel).toBeNull();
    expect(result.confidence).toBeNull();
    expect(result.competitorDifference).toEqual([]);
    // ロジックバージョンはinsufficient_evidence判定でも追跡できるようにする
    expect(result.analysisVersion).toBe(AIO_LOSS_ATTRIBUTION_LOGIC_VERSION);
  });

  it("judging evidence上で自院が言及されている観測が混ざる場合、原因を捏造せずinsufficient_evidenceを返す", () => {
    const result = attributeQuestionLoss([
      { mentioned: false, competitorMentions: [], sourceType: "canonical_measurement" },
      { mentioned: true, competitorMentions: [], sourceType: "canonical_measurement" },
    ]);
    expect(result.attributionStatus).toBe("insufficient_evidence");
    expect(result.rootCauseKey).toBeNull();
    expect(result.confidence).toBeNull();
    expect(result.provisional).toBe(false);
  });
});

function makeAttributed(
  overrides: Partial<PatientQuestionResult> & { question: string }
): PatientQuestionResult {
  return {
    status: "lose",
    unavailableReason: null,
    evidence: [],
    competitorDifference: [],
    rootCauseKey: "AIO:ai_search_presence",
    rootCauseLabel: "AIの回答に自院が表示されていない(AI検索での露出不足。競合も表示されていないケースを含む)",
    confidence: "medium",
    sourceType: "canonical_measurement",
    provisional: false,
    attributionStatus: "attributed",
    analysisVersion: AIO_LOSS_ATTRIBUTION_LOGIC_VERSION,
    ...overrides,
  };
}

describe("aggregateAioLossRootCauses(全体root cause TOP3の集約)", () => {
  it("close/insufficient_data/win等のnot_applicable・insufficient_evidenceは集約対象から除外される", () => {
    const questionResults: PatientQuestionResult[] = [
      makeAttributed({ question: "q-attributed" }),
      {
        question: "q-not-applicable",
        status: "win",
        unavailableReason: null,
        evidence: [],
        competitorDifference: [],
        rootCauseKey: null,
        rootCauseLabel: null,
        confidence: null,
        sourceType: null,
        provisional: false,
        attributionStatus: "not_applicable",
        analysisVersion: null,
      },
      {
        question: "q-insufficient-evidence",
        status: "lose",
        unavailableReason: null,
        evidence: [],
        competitorDifference: [],
        rootCauseKey: null,
        rootCauseLabel: null,
        confidence: null,
        sourceType: null,
        provisional: false,
        attributionStatus: "insufficient_evidence",
        analysisVersion: AIO_LOSS_ATTRIBUTION_LOGIC_VERSION,
      },
    ];
    const summaries = aggregateAioLossRootCauses(questionResults);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.linkedQuestions).toEqual(["q-attributed"]);
  });

  it("同一rootCauseKeyは複数質問にまたがっても1件へ統合され、traceability(linkedQuestions)を保持する", () => {
    const questionResults: PatientQuestionResult[] = [
      makeAttributed({
        question: "q1",
        rootCauseKey: "AIO:citation_acquisition",
        rootCauseLabel: "label",
        competitorDifference: ["競合A"],
        confidence: "high",
        sourceType: "canonical_measurement",
        provisional: false,
      }),
      makeAttributed({
        question: "q2",
        rootCauseKey: "AIO:citation_acquisition",
        rootCauseLabel: "label",
        competitorDifference: ["競合B"],
        confidence: "medium",
        sourceType: "mock",
        provisional: true,
      }),
    ];
    const summaries = aggregateAioLossRootCauses(questionResults);
    expect(summaries).toHaveLength(1);
    const summary = summaries[0]!;
    expect(summary.affectedQuestionCount).toBe(2);
    expect(summary.linkedQuestions).toEqual(["q1", "q2"]);
    // 複数質問が同一原因に紐づく場合、最も弱い(=最小)confidenceに合わせる
    expect(summary.confidence).toBe("medium");
    // linkedQuestions全体でユニークな競合名の件数
    expect(summary.competitorGapStrength).toBe(2);
    // 1件でもprovisionalが混ざれば全体もprovisional扱い
    expect(summary.isProvisional).toBe(true);
  });

  it("ランキングはconfidence→affectedQuestionCount→competitorGapStrength→provisionalの順で決定論的に決まる", () => {
    const questionResults: PatientQuestionResult[] = [
      makeAttributed({
        question: "q-medium",
        rootCauseKey: "AIO:ai_search_presence",
        confidence: "medium",
      }),
      makeAttributed({
        question: "q-high",
        rootCauseKey: "AIO:citation_acquisition",
        rootCauseLabel: "label",
        competitorDifference: ["競合A"],
        confidence: "high",
      }),
    ];
    const summaries = aggregateAioLossRootCauses(questionResults);
    expect(summaries[0]!.rootCauseKey).toBe("AIO:citation_acquisition");
    expect(summaries[1]!.rootCauseKey).toBe("AIO:ai_search_presence");
  });

  it("confidenceが同じ場合、影響したlose質問数が多いほうが上位に来る", () => {
    const questionResults: PatientQuestionResult[] = [
      makeAttributed({ question: "q1", rootCauseKey: "AIO:ai_search_presence" }),
      makeAttributed({
        question: "q2",
        rootCauseKey: "AIO:citation_acquisition",
        rootCauseLabel: "label",
        competitorDifference: ["競合X"],
      }),
      makeAttributed({
        question: "q3",
        rootCauseKey: "AIO:citation_acquisition",
        rootCauseLabel: "label",
        competitorDifference: ["競合Y"],
      }),
    ];
    const summaries = aggregateAioLossRootCauses(questionResults);
    expect(summaries[0]!.rootCauseKey).toBe("AIO:citation_acquisition");
    expect(summaries[0]!.affectedQuestionCount).toBe(2);
    expect(summaries[1]!.rootCauseKey).toBe("AIO:ai_search_presence");
  });

  it("root causeが3件未満の場合でも、無理に3件へ埋めない", () => {
    const questionResults: PatientQuestionResult[] = [makeAttributed({ question: "q1" })];
    const summaries = aggregateAioLossRootCauses(questionResults);
    expect(summaries).toHaveLength(1);
  });

  it("4件以上の異なるrootCauseKeyがあっても最大3件しか返さない", () => {
    const questionResults: PatientQuestionResult[] = [
      makeAttributed({ question: "q1", rootCauseKey: "AIO:ai_search_presence" }),
      makeAttributed({ question: "q2", rootCauseKey: "AIO:citation_acquisition", rootCauseLabel: "label" }),
      makeAttributed({ question: "q3", rootCauseKey: "AIO:recommendation_rank", rootCauseLabel: "label" }),
      makeAttributed({ question: "q4", rootCauseKey: "AIO:information_accuracy", rootCauseLabel: "label" }),
    ];
    const summaries = aggregateAioLossRootCauses(questionResults);
    expect(summaries.length).toBeLessThanOrEqual(3);
  });

  it("lose質問が1件も無い場合、空配列を返し例外を投げない", () => {
    expect(aggregateAioLossRootCauses([])).toEqual([]);
  });
});
