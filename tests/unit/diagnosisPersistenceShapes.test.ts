import { describe, expect, it } from "vitest";
import type { AdComplianceCheckResult } from "@/domain/ad-compliance/types";
import type { AiObservationResult } from "@/server/providers/ai/types";
import type { CriterionScore, UnavailableReason } from "@/domain/diagnosis/types";
import type { PatientQuestionResult } from "@/domain/competitor/types";
import { NOT_APPLICABLE_LOSS_ATTRIBUTION } from "@/domain/competitor/aioLossAttribution";
import type { DataGapInfo } from "@/domain/improvement-task/types";

/**
 * DiagnosisRepositoryが実際に行うJSON.stringify/JSON.parseの往復で、医療広告AIチェックの
 * 所見(sourceType/provisional/severity/confidence/evidence/escalationEligible)と
 * ai_observationsの構造(citations/region/dataSource等)が一切欠落しないことを検証する
 * (2026-09-05のユーザー指示⑤: JSON serialize / deserialize test)。
 * 実DBには一切触れない純粋なテストであり、このサンドボックス環境でも実行・確認済み。
 * 実際のDB往復(prisma経由)はtests/integration/diagnosisRepository.test.tsで別途検証する。
 */

function roundTrip<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("AdComplianceCheckResultのJSON往復(diagnosisRepositoryが行うstringify/parseと同じ操作)", () => {
  const sample: AdComplianceCheckResult = {
    findings: [
      {
        id: "safety_assertion#1",
        category: "safety_assertion",
        severity: "high",
        confidence: "high",
        matchStrength: "direct",
        confidenceBasis: "test basis",
        evidence: [
          {
            category: "safety_assertion",
            quotedText: "test quoted text",
            sourceLocation: "test location",
            detectionReason: "test reason",
            sourceType: "rule_based",
          },
        ],
        mergedOccurrenceCount: 1,
        displayMessage: "AIによるリスクチェック: test",
        requiresReviewBy: "院長",
        escalationEligible: true,
        sourceType: "rule_based",
        provisional: false,
        sourceLabel: "実際の入力に基づく検出結果",
      },
      {
        id: "review_incentive#1",
        category: "review_incentive",
        severity: "high",
        confidence: "high",
        matchStrength: "direct",
        confidenceBasis: "test basis 2",
        evidence: [
          {
            category: "review_incentive",
            quotedText: "mock quoted text",
            sourceLocation: "mock location",
            detectionReason: "mock reason",
            sourceType: "mock",
          },
        ],
        mergedOccurrenceCount: 1,
        displayMessage: "AIによるリスクチェック(要確認): test",
        requiresReviewBy: "院長",
        escalationEligible: false,
        sourceType: "mock",
        provisional: true,
        sourceLabel: "開発用サンプル(実測ではありません)",
      },
    ],
    disclaimer: "これはAIによるリスクチェックであり、法令違反を断定するものではありません。最終判断は医院または専門家が行ってください。",
    checkedAt: "2026-01-01T00:00:00.000Z",
  };

  it("findings配列の全フィールド(sourceType/provisional/severity/confidence/evidence/escalationEligible)が往復後も一致する", () => {
    const restored = roundTrip(sample);
    expect(restored).toEqual(sample);
    // 個別に明示チェック(将来どれか1フィールドだけ壊れた場合に原因を特定しやすくするため)
    expect(restored.findings[0]!.sourceType).toBe("rule_based");
    expect(restored.findings[0]!.provisional).toBe(false);
    expect(restored.findings[0]!.escalationEligible).toBe(true);
    expect(restored.findings[1]!.sourceType).toBe("mock");
    expect(restored.findings[1]!.provisional).toBe(true);
    expect(restored.findings[1]!.escalationEligible).toBe(false);
    expect(restored.findings[1]!.evidence[0]!.sourceType).toBe("mock");
  });

  it("所見0件でも往復後にdisclaimer/checkedAtが保持される", () => {
    const empty: AdComplianceCheckResult = { findings: [], disclaimer: sample.disclaimer, checkedAt: sample.checkedAt };
    const restored = roundTrip(empty);
    expect(restored).toEqual(empty);
  });
});

describe("AiObservationResult[]のJSON往復(ai_observationsとして保存する内容)", () => {
  const sample: AiObservationResult[] = [
    {
      question: "駅から近いおすすめの歯医者は?",
      aiProvider: "chatgpt",
      model: "mock-gpt",
      mentioned: true,
      recommendationRank: 1,
      competitorMentions: ["競合A"],
      citations: [],
      region: null,
      evidence: "test evidence",
      dataSource: "mock",
      capturedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      question: "土日も診療している歯科医院は?",
      aiProvider: "gemini",
      model: "live-gemini",
      mentioned: false,
      recommendationRank: null,
      competitorMentions: [],
      citations: ["https://example.com/a"],
      region: "tokyo",
      evidence: "test evidence 2",
      dataSource: "live",
      capturedAt: "2026-01-01T00:00:01.000Z",
    },
  ];

  it("citations/region/recommendationRank(null含む)/dataSourceが往復後も一致する", () => {
    const restored = roundTrip(sample);
    expect(restored).toEqual(sample);
    expect(restored[0]!.recommendationRank).toBe(1);
    expect(restored[0]!.citations).toEqual([]);
    expect(restored[0]!.region).toBeNull();
    expect(restored[1]!.recommendationRank).toBeNull();
    expect(restored[1]!.citations).toEqual(["https://example.com/a"]);
    expect(restored[1]!.region).toBe("tokyo");
    expect(restored[1]!.dataSource).toBe("live");
  });
});

describe("unavailableReasonのJSON往復(2026-09-06のユーザー指示④: scoreBreakdownJson/questionResultsJson/improvementTasksJsonはdomain objectをそのまま保存するため)", () => {
  const ALL_REASONS: UnavailableReason[] = [
    "not_provided",
    "not_connected",
    "permission_required",
    "insufficient_data",
    "temporarily_unavailable",
    "fetch_failed",
    "not_applicable",
  ];

  it.each(ALL_REASONS)("CriterionScore(status=unavailable, reason=%s)が往復後も保持される", (reason) => {
    const sample: CriterionScore = {
      key: "test_key",
      label: "テスト項目",
      maxScore: 10,
      score: null,
      status: "unavailable",
      evidence: [{ summary: "test" }],
      measuredAt: null,
      dataSource: "mock",
      unavailableReason: reason,
    };
    const restored = roundTrip(sample);
    expect(restored).toEqual(sample);
    expect(restored.unavailableReason).toBe(reason);
    expect(restored.score).toBeNull();
  });

  it("CriterionScore(status=estimated)はunavailableReason=nullのまま往復する(0点変換されず、理由も付かない)", () => {
    const sample: CriterionScore = {
      key: "test_key",
      label: "テスト項目",
      maxScore: 10,
      score: 7,
      status: "estimated",
      evidence: [{ summary: "test" }],
      measuredAt: "2026-01-01T00:00:00.000Z",
      dataSource: "mock",
      unavailableReason: null,
    };
    const restored = roundTrip(sample);
    expect(restored.unavailableReason).toBeNull();
    expect(restored.score).toBe(7);
  });

  it("PatientQuestionResult(status=insufficient_data)のunavailableReasonが往復後も保持される", () => {
    const sample: PatientQuestionResult = {
      question: "q1",
      status: "insufficient_data",
      unavailableReason: "insufficient_data",
      evidence: [],
      ...NOT_APPLICABLE_LOSS_ATTRIBUTION,
    };
    const restored = roundTrip(sample);
    expect(restored.unavailableReason).toBe("insufficient_data");
  });

  it("PatientQuestionResult(status=lose)はunavailableReason=nullのまま往復する", () => {
    const sample: PatientQuestionResult = {
      question: "q1",
      status: "lose",
      unavailableReason: null,
      evidence: ["ev"],
      ...NOT_APPLICABLE_LOSS_ATTRIBUTION,
    };
    const restored = roundTrip(sample);
    expect(restored.unavailableReason).toBeNull();
  });

  it.each(ALL_REASONS)("DataGapInfo(reason=%s)が往復後も保持される", (reason) => {
    const sample: DataGapInfo = {
      status: reason === "insufficient_data" ? "insufficient_data" : "unavailable",
      reason: "test: 人間向け説明文",
      unavailableReason: reason,
      blocking: true,
    };
    const restored = roundTrip(sample);
    expect(restored.unavailableReason).toBe(reason);
  });
});


describe("PatientQuestionResultのroot cause属性(2026-09-06のユーザー指示)のJSON往復", () => {
  it("attributionStatus=attributed(AIO:citation_acquisition)のroot cause属性が往復後も保持される", () => {
    const sample: PatientQuestionResult = {
      question: "q-citation",
      status: "lose",
      unavailableReason: null,
      evidence: ["[chatgpt] 競合Aのみ引用された"],
      competitorDifference: ["競合クリニックA"],
      rootCauseKey: "AIO:citation_acquisition",
      rootCauseLabel: "AIの回答で競合は引用・言及されているが、自院は引用・言及されていない(引用獲得の差)",
      confidence: "medium",
      sourceType: "mock",
      provisional: true,
      attributionStatus: "attributed",
      analysisVersion: "aio-loss-attribution@2026-09-08.1",
    };
    const restored = roundTrip(sample);
    expect(restored.competitorDifference).toEqual(["競合クリニックA"]);
    expect(restored.rootCauseKey).toBe("AIO:citation_acquisition");
    expect(restored.confidence).toBe("medium");
    expect(restored.sourceType).toBe("mock");
    expect(restored.provisional).toBe(true);
    expect(restored.attributionStatus).toBe("attributed");
    expect(restored.analysisVersion).toBe("aio-loss-attribution@2026-09-08.1");
  });

  it("attributionStatus=attributed(canonical measured lose、sourceType=canonical_measurement)のroot cause属性が往復後も保持される(2026-09-08のユーザー指示: canonical measured loseのroot cause本接続ラウンド)", () => {
    const sample: PatientQuestionResult = {
      question: "q-canonical-lose",
      status: "lose",
      statusSource: "canonical_measurement",
      unavailableReason: null,
      evidence: ["[openai] test: canonical evidence (measured)"],
      competitorDifference: ["Canonical Competitor A"],
      rootCauseKey: "AIO:ai_search_presence",
      rootCauseLabel:
        "AIの回答に自院が表示されていない(AI検索での露出不足。競合も表示されていないケースを含む)",
      confidence: "medium",
      sourceType: "canonical_measurement",
      provisional: false,
      attributionStatus: "attributed",
      analysisVersion: "aio-loss-attribution@2026-09-08.1",
      measurementCoverage: {
        totalProviders: 1,
        measuredProviders: 1,
        referenceProviders: 0,
        unavailableProviders: 0,
        isPartial: false,
      },
    };
    const restored = roundTrip(sample);
    expect(restored).toEqual(sample);
    expect(restored.sourceType).toBe("canonical_measurement");
    expect(restored.provisional).toBe(false);
    expect(restored.statusSource).toBe("canonical_measurement");
    expect(restored.competitorDifference).toEqual(["Canonical Competitor A"]);
  });

  it("attributionStatus=insufficient_evidenceのときrootCauseKey等がnullのまま往復する", () => {
    const sample: PatientQuestionResult = {
      question: "q-insufficient",
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
      analysisVersion: "aio-loss-attribution@2026-09-08.1",
    };
    const restored = roundTrip(sample);
    expect(restored.rootCauseKey).toBeNull();
    expect(restored.rootCauseLabel).toBeNull();
    expect(restored.confidence).toBeNull();
    expect(restored.attributionStatus).toBe("insufficient_evidence");
  });

  it("status!==\"lose\"のnot_applicable既定値がそのまま往復する", () => {
    const sample: PatientQuestionResult = {
      question: "q-win",
      status: "win",
      unavailableReason: null,
      evidence: ["[chatgpt] 自院が1位で紹介された"],
      ...NOT_APPLICABLE_LOSS_ATTRIBUTION,
    };
    const restored = roundTrip(sample);
    expect(restored.attributionStatus).toBe("not_applicable");
    expect(restored.rootCauseKey).toBeNull();
    expect(restored.analysisVersion).toBeNull();
    expect(restored.provisional).toBe(false);
    expect(restored.competitorDifference).toEqual([]);
  });
});
