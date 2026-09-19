import { describe, expect, it } from "vitest";
import {
  AD_COMPLIANCE_DISCLAIMER,
  AD_COMPLIANCE_MANDATORY_PHRASES,
  AD_RISK_CATEGORY_CATALOG,
  capSeverityForCategory,
  deriveConfidence,
  describeAdRiskMessage,
  describeSourceLabel,
  getAdRiskCategoryDefinition,
  isProvisionalSourceType,
} from "@/domain/ad-compliance/riskCatalog";
import type { AdRiskFindingSourceType, AdRiskMatchStrength, AdRiskSeverity } from "@/domain/ad-compliance/types";

const NON_MOCK_SOURCE_TYPES: AdRiskFindingSourceType[] = ["rule_based", "live_page", "review_text", "ai_provider"];

/**
 * 医療広告AIチェック(P0)のカタログ完全性・表示ルール(「違反断定ではなくリスクチェック」)を
 * 機械的に検証する(2026-09-05のユーザー指示: 実装時の追加条件1、最低限テスト項目)。
 */

const EXPECTED_CATEGORY_KEYS = [
  "superlative_exaggeration",
  "comparative_superiority",
  "safety_assertion",
  "efficacy_assertion",
  "unfounded_numbers",
  "self_pay_disclosure_gap",
  "patient_testimonial",
  "before_after_gap",
  "review_incentive",
  "review_response_pii",
  "other_general_risk",
];

describe("AD_RISK_CATEGORY_CATALOG(11分類の完全性)", () => {
  it("ご指示の11分類がすべて存在し、keyの重複がない", () => {
    const keys = AD_RISK_CATEGORY_CATALOG.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.sort()).toEqual([...EXPECTED_CATEGORY_KEYS].sort());
  });

  it("label・sourceRef・defaultRequiresReviewByが全カテゴリで空文字ではない", () => {
    for (const def of AD_RISK_CATEGORY_CATALOG) {
      expect(def.label.length, `${def.key}: labelが空`).toBeGreaterThan(0);
      expect(def.sourceRef.length, `${def.key}: sourceRefが空`).toBeGreaterThan(0);
      expect(def.defaultRequiresReviewBy.length, `${def.key}: defaultRequiresReviewByが空`).toBeGreaterThan(0);
    }
  });

  it("other_general_riskのみallowHighSeverity=falseであり、他の10分類はtrueである", () => {
    for (const def of AD_RISK_CATEGORY_CATALOG) {
      if (def.key === "other_general_risk") {
        expect(def.allowHighSeverity).toBe(false);
      } else {
        expect(def.allowHighSeverity, `${def.key}: allowHighSeverityがtrueであるべき`).toBe(true);
      }
    }
  });
});

describe("capSeverityForCategory(other_general_riskのseverity上限、追加条件1関連)", () => {
  it("other_general_riskはseverity=highを指定してもmediumに補正される", () => {
    expect(capSeverityForCategory("other_general_risk", "high")).toBe("medium");
  });

  it("other_general_risk以外はseverityをそのまま維持する", () => {
    for (const def of AD_RISK_CATEGORY_CATALOG) {
      if (def.key === "other_general_risk") continue;
      expect(capSeverityForCategory(def.key, "high")).toBe("high");
    }
  });
});

describe("deriveConfidence(confidenceはmatchStrengthからのみ導出される、追加条件2)", () => {
  it.each([
    ["direct", "high"],
    ["partial", "medium"],
    ["inferred", "low"],
  ] as Array<[AdRiskMatchStrength, string]>)("matchStrength=%sはconfidence=%sになる", (matchStrength, expected) => {
    expect(deriveConfidence(matchStrength)).toBe(expected);
  });
});

describe("describeAdRiskMessage / AD_COMPLIANCE_DISCLAIMER(表示ルールの機械的担保、設計5節)", () => {
  const severities: AdRiskSeverity[] = ["high", "medium", "low"];
  const eligibilities = [true, false];

  function allMessages(): string[] {
    const messages: string[] = [];
    for (const severity of severities) {
      for (const eligible of eligibilities) {
        messages.push(describeAdRiskMessage(severity, eligible));
      }
    }
    messages.push(AD_COMPLIANCE_DISCLAIMER);
    return messages;
  }

  it("すべての表示文言・disclaimerに必須3文言がすべて含まれる", () => {
    for (const message of allMessages()) {
      for (const phrase of AD_COMPLIANCE_MANDATORY_PHRASES) {
        expect(message, `"${message}" に "${phrase}" が含まれていません`).toContain(phrase);
      }
    }
  });

  it("「抵触」という語は一切使用しない", () => {
    for (const message of allMessages()) {
      expect(message).not.toContain("抵触");
    }
  });

  it("「違反」という語は、必須の否定フレーズ「法令違反を断定するものではありません」の中でのみ使用される" , () => {
    for (const message of allMessages()) {
      const totalOccurrences = message.split("違反").length - 1;
      const mandatoryPhraseOccurrences = message.split("法令違反を断定するものではありません").length - 1;
      // 「違反」の全出現が、必須の否定フレーズ由来の出現数と一致する(=それ以外の場所に「違反」がない)
      expect(
        totalOccurrences,
        `"${message}" に必須フレーズ外の「違反」が含まれています`
      ).toBe(mandatoryPhraseOccurrences);
    }
  });

  it("severity=high かつ escalationEligible=falseのときは「要確認」を含む", () => {
    expect(describeAdRiskMessage("high", false)).toContain("要確認");
  });
});

describe("isProvisionalSourceType / describeSourceLabel(mock由来のfindingを機械的に判別する、2026-09-05のユーザー指示)", () => {
  it("sourceType=mockのみprovisionalであり、それ以外の由来はprovisionalではない", () => {
    expect(isProvisionalSourceType("mock")).toBe(true);
    for (const sourceType of NON_MOCK_SOURCE_TYPES) {
      expect(isProvisionalSourceType(sourceType), `${sourceType}はprovisionalではないはず`).toBe(false);
    }
  });

  it("sourceType=mockのsourceLabelには開発用サンプル・実測ではない旨が含まれ、それ以外の由来とは異なる文言になる", () => {
    const mockLabel = describeSourceLabel("mock");
    expect(mockLabel).toMatch(/開発用サンプル|実測ではありません/);
    for (const sourceType of NON_MOCK_SOURCE_TYPES) {
      expect(describeSourceLabel(sourceType), `${sourceType}のsourceLabelがmockと同一になっている`).not.toBe(mockLabel);
    }
  });
});

describe("getAdRiskCategoryDefinition", () => {
  it("未定義のkeyを渡すとエラーになる", () => {
    // @ts-expect-error 意図的に不正なkeyを渡す
    expect(() => getAdRiskCategoryDefinition("not_a_real_category")).toThrow();
  });
});
