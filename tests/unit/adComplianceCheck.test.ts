import { describe, expect, it } from "vitest";
import { buildAdComplianceResult } from "@/domain/ad-compliance/buildAdComplianceResult";
import { isEscalationEligible } from "@/domain/ad-compliance/escalationEligibility";
import type {
  AdRiskConfidence,
  AdRiskFindingSourceType,
  AdRiskSeverity,
  RawAdRiskFinding,
} from "@/domain/ad-compliance/types";

const FIXED_AT = "2026-01-01T00:00:00.000Z";

// デフォルトはsourceType="rule_based"(=mockではない実際の検出扱い)とする。
// mock由来かどうかを検証するテストでは明示的にsourceType: "mock"を上書きする。
function raw(overrides: Partial<RawAdRiskFinding> = {}): RawAdRiskFinding {
  return {
    category: "superlative_exaggeration",
    severity: "high",
    matchStrength: "direct",
    quotedText: "当院は日本一の技術力です",
    sourceLocation: "トップページ本文",
    detectionReason: "test: パターン一致",
    sourceType: "rule_based",
    ...overrides,
  };
}

/**
 * 医療広告AIチェック(P0)のコアロジック検証(2026-09-05のユーザー指示: 最低限テスト項目)。
 */

describe("isEscalationEligible(severity × confidence の境界値、追加条件7)", () => {
  it.each([
    ["high", "high", true],
    ["high", "medium", true],
    ["high", "low", false],
    ["medium", "high", false],
    ["medium", "medium", false],
    ["medium", "low", false],
    ["low", "high", false],
    ["low", "medium", false],
    ["low", "low", false],
  ] as Array<[AdRiskSeverity, AdRiskConfidence, boolean]>)(
    "sourceType=rule_based, severity=%s, confidence=%s → eligible=%s",
    (severity, confidence, expected) => {
      expect(isEscalationEligible({ severity, confidence, sourceType: "rule_based" })).toBe(expected);
    }
  );
});

describe("isEscalationEligible: sourceType=mockは常にescalation不可(2026-09-05のユーザー指示)", () => {
  it.each([
    ["mock", "high", "high", false],
    ["mock", "high", "medium", false],
    ["mock", "high", "low", false],
    ["live_page", "high", "high", true],
    ["rule_based", "high", "high", true],
    ["review_text", "high", "high", true],
    ["ai_provider", "high", "high", true],
  ] as Array<[AdRiskFindingSourceType, AdRiskSeverity, AdRiskConfidence, boolean]>)(
    "sourceType=%s, severity=%s, confidence=%s → eligible=%s",
    (sourceType, severity, confidence, expected) => {
      expect(isEscalationEligible({ severity, confidence, sourceType })).toBe(expected);
    }
  );

  it("sourceType=mockはseverity=high・confidence=high(最も強い組み合わせ)でもescalation不可になる", () => {
    expect(isEscalationEligible({ severity: "high", confidence: "high", sourceType: "mock" })).toBe(false);
  });
});

describe("buildAdComplianceResult: confidenceの過大評価防止(追加条件2)", () => {
  it("evidence不足(matchStrength=inferred)の場合、severity=highでもconfidenceはlowになり、エスカレーション対象外になる", () => {
    const result = buildAdComplianceResult(
      [raw({ severity: "high", matchStrength: "inferred" })],
      FIXED_AT
    );
    const finding = result.findings[0]!;
    expect(finding.confidence).toBe("low");
    expect(finding.escalationEligible).toBe(false);
  });

  it("matchStrength=partialの場合、confidenceはmediumに留まりhighにはならない", () => {
    const result = buildAdComplianceResult(
      [raw({ severity: "high", matchStrength: "partial" })],
      FIXED_AT
    );
    expect(result.findings[0]!.confidence).toBe("medium");
  });

  it("matchStrength=directかつseverity=highの場合のみconfidence=highかつエスカレーション対象になる", () => {
    const result = buildAdComplianceResult(
      [raw({ severity: "high", matchStrength: "direct" })],
      FIXED_AT
    );
    const finding = result.findings[0]!;
    expect(finding.confidence).toBe("high");
    expect(finding.escalationEligible).toBe(true);
  });

  it("other_general_riskはproviderがseverity=highを返してもmediumに補正され、エスカレーション対象にならない", () => {
    const result = buildAdComplianceResult(
      [raw({ category: "other_general_risk", severity: "high", matchStrength: "direct" })],
      FIXED_AT
    );
    const finding = result.findings[0]!;
    expect(finding.severity).toBe("medium");
    expect(finding.escalationEligible).toBe(false);
  });
});

describe("buildAdComplianceResult: 同一リスクの重複整理(追加条件4)", () => {
  it("同一カテゴリ・同一箇所の所見は1件に統合され、evidenceがまとめられる", () => {
    const result = buildAdComplianceResult(
      [
        raw({ quotedText: "当院は日本一です", sourceLocation: "トップページ本文" }),
        raw({ quotedText: "必ず成功します", sourceLocation: "トップページ本文" }),
      ],
      FIXED_AT
    );
    expect(result.findings.length).toBe(1);
    const finding = result.findings[0]!;
    expect(finding.mergedOccurrenceCount).toBe(2);
    expect(finding.evidence.length).toBe(2);
  });

  it("カテゴリまたは箇所が異なる所見は統合されない", () => {
    const result = buildAdComplianceResult(
      [
        raw({ category: "superlative_exaggeration", sourceLocation: "トップページ本文" }),
        raw({ category: "comparative_superiority", sourceLocation: "トップページ本文" }),
        raw({ category: "superlative_exaggeration", sourceLocation: "診療案内ページ本文" }),
      ],
      FIXED_AT
    );
    expect(result.findings.length).toBe(3);
    expect(result.findings.every((f) => f.mergedOccurrenceCount === 1)).toBe(true);
  });

  it("重複整理では、統合後の代表severity・matchStrengthとしてグループ内で最も強いものが採用される", () => {
    const result = buildAdComplianceResult(
      [
        raw({ severity: "low", matchStrength: "inferred", sourceLocation: "同一箇所" }),
        raw({ severity: "high", matchStrength: "direct", sourceLocation: "同一箇所" }),
      ],
      FIXED_AT
    );
    const finding = result.findings[0]!;
    expect(finding.severity).toBe("high");
    expect(finding.matchStrength).toBe("direct");
    expect(finding.confidence).toBe("high");
  });
});

describe("buildAdComplianceResult: 個人情報のマスキング(追加条件5)", () => {
  it("review_response_piiカテゴリの所見は、evidenceの引用文から生のPII文字列が除去される", () => {
    const phone = "03-1234-5678";
    const result = buildAdComplianceResult(
      [
        raw({
          category: "review_response_pii",
          severity: "high",
          matchStrength: "direct",
          quotedText: `お電話ありがとうございました。折り返しは${phone}までお願いします。`,
          sourceLocation: "口コミ返信(1件目)",
        }),
      ],
      FIXED_AT
    );
    const evidenceText = result.findings[0]!.evidence.map((e) => e.quotedText).join(" ");
    expect(evidenceText).not.toContain(phone);
    expect(evidenceText).toContain("[個人情報を検出:");
  });

  it("review_response_pii以外のカテゴリでは引用文をマスキングしない", () => {
    const text = "当院は日本一の技術力です(03-1234-5678でお問い合わせください)";
    const result = buildAdComplianceResult(
      [raw({ category: "superlative_exaggeration", quotedText: text })],
      FIXED_AT
    );
    expect(result.findings[0]!.evidence[0]!.quotedText).toContain("03-1234-5678");
  });
});

describe("buildAdComplianceResult: sourceType=mockはescalation対象外・provisional扱い(2026-09-05のユーザー指示)", () => {
  it("sourceType=mock かつ severity=high・matchStrength=direct(=confidence=high)でもescalationEligibleはfalseになる", () => {
    const result = buildAdComplianceResult(
      [raw({ severity: "high", matchStrength: "direct", sourceType: "mock" })],
      FIXED_AT
    );
    const finding = result.findings[0]!;
    expect(finding.confidence).toBe("high");
    expect(finding.escalationEligible).toBe(false);
  });

  it("sourceType=mockの所見はprovisional=trueであり、sourceLabelに開発用サンプルである旨が示される(実測扱いにならない)", () => {
    const result = buildAdComplianceResult(
      [raw({ severity: "high", matchStrength: "direct", sourceType: "mock" })],
      FIXED_AT
    );
    const finding = result.findings[0]!;
    expect(finding.sourceType).toBe("mock");
    expect(finding.provisional).toBe(true);
    expect(finding.sourceLabel).toMatch(/開発用サンプル|実測ではありません/);
  });

  it("sourceType=live_page/rule_based/review_text/ai_providerの所見はprovisional=falseであり、severity=high・confidence十分ならescalationEligible=trueになる", () => {
    for (const sourceType of ["live_page", "rule_based", "review_text", "ai_provider"] as const) {
      const result = buildAdComplianceResult(
        [raw({ severity: "high", matchStrength: "direct", sourceType })],
        FIXED_AT
      );
      const finding = result.findings[0]!;
      expect(finding.provisional, `sourceType=${sourceType}: provisionalがfalseであるべき`).toBe(false);
      expect(finding.escalationEligible, `sourceType=${sourceType}: escalationEligibleがtrueであるべき`).toBe(true);
    }
  });

  it("同一カテゴリ・同一箇所でmock由来と非mock(実測)由来の所見が混在した場合、非mockのevidenceが1件でもあればfinding全体をmock扱いにはしない(mockが実測データを汚染してはいけない、2026-09-05の再修正指示)", () => {
    const result = buildAdComplianceResult(
      [
        raw({ severity: "high", matchStrength: "direct", sourceType: "mock", sourceLocation: "同一箇所" }),
        raw({ severity: "high", matchStrength: "direct", sourceType: "rule_based", sourceLocation: "同一箇所" }),
      ],
      FIXED_AT
    );
    expect(result.findings.length).toBe(1);
    const finding = result.findings[0]!;
    expect(finding.sourceType).toBe("rule_based");
    expect(finding.provisional).toBe(false);
    expect(finding.escalationEligible).toBe(true);
  });

  it("live_page + mockが混在する場合、live_page側の根拠だけでseverity/confidence/escalationが判定される", () => {
    const result = buildAdComplianceResult(
      [
        // mock側はseverity=highでも判定には使われない
        raw({ severity: "high", matchStrength: "direct", sourceType: "mock", sourceLocation: "同一箇所" }),
        raw({ severity: "medium", matchStrength: "partial", sourceType: "live_page", sourceLocation: "同一箇所" }),
      ],
      FIXED_AT
    );
    const finding = result.findings[0]!;
    // mockのseverity=high/matchStrength=directは無視され、live_page側(medium/partial)だけで判定される
    expect(finding.severity).toBe("medium");
    expect(finding.confidence).toBe("medium");
    expect(finding.sourceType).toBe("live_page");
    expect(finding.provisional).toBe(false);
    expect(finding.escalationEligible).toBe(false); // severity=mediumのためescalation不可
  });

  it("review_text + mockが混在する場合、review_textの実検出結果をmockが無効化しない(review_textの根拠だけでeligibleになる)", () => {
    const result = buildAdComplianceResult(
      [
        raw({
          category: "review_response_pii",
          severity: "low",
          matchStrength: "inferred",
          sourceType: "mock",
          sourceLocation: "同一箇所",
        }),
        raw({
          category: "review_response_pii",
          severity: "high",
          matchStrength: "direct",
          sourceType: "review_text",
          sourceLocation: "同一箇所",
        }),
      ],
      FIXED_AT
    );
    const finding = result.findings[0]!;
    expect(finding.severity).toBe("high");
    expect(finding.confidence).toBe("high");
    expect(finding.sourceType).toBe("review_text");
    expect(finding.provisional).toBe(false);
    expect(finding.escalationEligible).toBe(true);
  });

  it("mockのmatchStrengthが非mockより強くても、mock混在によってconfidenceが上昇しない(mock evidenceをconfidenceの根拠に使わない)", () => {
    const result = buildAdComplianceResult(
      [
        // mock側はmatchStrength=direct(最も強い)だが、判定には一切使われない
        raw({ severity: "high", matchStrength: "direct", sourceType: "mock", sourceLocation: "同一箇所" }),
        // 非mock側はmatchStrength=inferred(最も弱い) = confidence=lowにしかならないはず
        raw({ severity: "high", matchStrength: "inferred", sourceType: "rule_based", sourceLocation: "同一箇所" }),
      ],
      FIXED_AT
    );
    const finding = result.findings[0]!;
    // mockのdirectに引っ張られてconfidence=highになってはいけない。非mock側のinferred通りlowになる
    expect(finding.confidence).toBe("low");
    expect(finding.matchStrength).toBe("inferred");
    expect(finding.escalationEligible).toBe(false);
  });

  it("非mockのevidenceが1件も存在しない(全件mock)場合のみprovisional=trueになる", () => {
    const allMock = buildAdComplianceResult(
      [
        raw({ severity: "high", matchStrength: "direct", sourceType: "mock", sourceLocation: "全件mock箇所" }),
        raw({ severity: "high", matchStrength: "direct", sourceType: "mock", sourceLocation: "全件mock箇所" }),
      ],
      FIXED_AT
    );
    expect(allMock.findings[0]!.provisional).toBe(true);
    expect(allMock.findings[0]!.sourceType).toBe("mock");

    const mixed = buildAdComplianceResult(
      [
        raw({ severity: "high", matchStrength: "direct", sourceType: "mock", sourceLocation: "混在箇所" }),
        raw({ severity: "low", matchStrength: "inferred", sourceType: "live_page", sourceLocation: "混在箇所" }),
      ],
      FIXED_AT
    );
    expect(mixed.findings[0]!.provisional).toBe(false);
  });

  it("evidence配列は(mock混在時も含め)全件を保持しつつ、evidence単位のsourceTypeでmock由来かどうかを個別に判別できる", () => {
    const result = buildAdComplianceResult(
      [
        raw({ severity: "high", matchStrength: "direct", sourceType: "mock", sourceLocation: "同一箇所", quotedText: "mock evidence" }),
        raw({ severity: "high", matchStrength: "direct", sourceType: "rule_based", sourceLocation: "同一箇所", quotedText: "real evidence" }),
      ],
      FIXED_AT
    );
    const finding = result.findings[0]!;
    expect(finding.evidence.length).toBe(2);
    expect(finding.evidence.some((e) => e.sourceType === "mock")).toBe(true);
    expect(finding.evidence.some((e) => e.sourceType === "rule_based")).toBe(true);
  });

  it("mockのみ(非mockが全く存在しない)所見は、matchStrength=direct(confidence=high)でもescalation不可になる", () => {
    const result = buildAdComplianceResult(
      [raw({ severity: "high", matchStrength: "direct", sourceType: "mock" })],
      FIXED_AT
    );
    const finding = result.findings[0]!;
    expect(finding.confidence).toBe("high");
    expect(finding.escalationEligible).toBe(false);
    expect(finding.provisional).toBe(true);
  });
});

describe("buildAdComplianceResult: disclaimer・空配列時の挙動", () => {
  it("所見が0件でもdisclaimerは常に返され、findingsは空配列になる", () => {
    const result = buildAdComplianceResult([], FIXED_AT);
    expect(result.findings).toEqual([]);
    expect(result.disclaimer.length).toBeGreaterThan(0);
    expect(result.checkedAt).toBe(FIXED_AT);
  });
});

describe("buildAdComplianceResult: displayMessageの表示ルール整合性", () => {
  it("escalationEligible=trueの所見はdisplayMessageに「要確認」を含まない(断定はしないが確認保留の文言にはしない)", () => {
    const result = buildAdComplianceResult(
      [raw({ severity: "high", matchStrength: "direct" })],
      FIXED_AT
    );
    expect(result.findings[0]!.displayMessage).not.toContain("要確認");
  });

  it("severity=high かつ escalationEligible=falseの所見はdisplayMessageに「要確認」を含む", () => {
    const result = buildAdComplianceResult(
      [raw({ severity: "high", matchStrength: "inferred" })],
      FIXED_AT
    );
    expect(result.findings[0]!.displayMessage).toContain("要確認");
  });
});
