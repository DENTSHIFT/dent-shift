import { describe, expect, it } from "vitest";
import { IMPROVEMENT_RULE_CATALOG } from "@/domain/improvement-task/candidateCatalog";
import { ESCALATION_CATEGORY_ORDER } from "@/domain/improvement-task/types";
import { DOMAIN_CRITERIA, DOMAIN_ORDER } from "@/domain/diagnosis/scoreCriteria";
import type { CriterionDefinition } from "@/domain/diagnosis/scoreCriteria";
import type { DomainKey } from "@/domain/diagnosis/types";

/**
 * 正本(docs/source/DENT_SHIFT_AI改善アクション生成ロジック_Ver1.pdf §2〜7)の
 * 45項目カタログが漏れなく存在することを検証する(2026-09-05のユーザー指示)。
 */

// 正本§2〜7の各章の項目数(GAP_ANALYSIS_2026-09-04.mdおよび正本PDFの表の行数と一致)
const EXPECTED_DOMAIN_COUNTS: Record<DomainKey, number> = {
  AIO: 7,
  LLMO: 6,
  MEO: 7,
  SEO: 7,
  WEB_BOOKING: 10,
  REVIEWS: 8,
};

describe("IMPROVEMENT_RULE_CATALOG(正本45項目の完全性)", () => {
  it("正本の45項目すべてが存在する", () => {
    expect(IMPROVEMENT_RULE_CATALOG.length).toBe(45);
  });

  it("各領域(章、displayDomain)の項目数が正本の表の行数と一致する", () => {
    const counts: Partial<Record<DomainKey, number>> = {};
    for (const rule of IMPROVEMENT_RULE_CATALOG) {
      counts[rule.displayDomain] = (counts[rule.displayDomain] ?? 0) + 1;
    }
    for (const domain of DOMAIN_ORDER) {
      expect(counts[domain] ?? 0).toBe(EXPECTED_DOMAIN_COUNTS[domain]);
    }
  });

  it("keyがすべて一意である", () => {
    const keys = IMPROVEMENT_RULE_CATALOG.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("ruleKeyがすべて一意である", () => {
    const ruleKeys = IMPROVEMENT_RULE_CATALOG.map((r) => r.ruleKey);
    expect(new Set(ruleKeys).size).toBe(ruleKeys.length);
  });

  it("各ルールのdiagnosticAnchorが、正本のスコア配点(scoreCriteria.ts)に実在するcriterionを参照している", () => {
    for (const rule of IMPROVEMENT_RULE_CATALOG) {
      const definitions: CriterionDefinition[] = DOMAIN_CRITERIA[rule.diagnosticAnchor.domain];
      const found = definitions.some((def) => def.key === rule.diagnosticAnchor.criterionKey);
      expect(
        found,
        `${rule.key}: diagnosticAnchor ${rule.diagnosticAnchor.domain}/${rule.diagnosticAnchor.criterionKey} が scoreCriteria.ts に存在しません`
      ).toBe(true);
    }
  });

  it("rootCauseKeyがevidenceDomainとdiagnosticAnchor.criterionKeyから一貫して生成されている", () => {
    for (const rule of IMPROVEMENT_RULE_CATALOG) {
      expect(rule.rootCauseKey).toBe(`${rule.evidenceDomain}:${rule.diagnosticAnchor.criterionKey}`);
      expect(rule.evidenceDomain).toBe(rule.diagnosticAnchor.domain);
    }
  });

  it("triggerRules/evidenceRequirementsが少なくとも1件ずつ設定されており、diagnosticAnchorを参照している", () => {
    for (const rule of IMPROVEMENT_RULE_CATALOG) {
      expect(rule.triggerRules.length, `${rule.key}: triggerRulesが空`).toBeGreaterThan(0);
      expect(rule.evidenceRequirements.length, `${rule.key}: evidenceRequirementsが空`).toBeGreaterThan(0);
      for (const trigger of rule.triggerRules) {
        expect(trigger.criterion).toEqual(rule.diagnosticAnchor);
      }
    }
  });

  it("45項目すべてがprovisional:trueである(正式仕様として未確定であることの明示)", () => {
    for (const rule of IMPROVEMENT_RULE_CATALOG) {
      expect(rule.provisional, `${rule.key}: provisionalがtrueではない`).toBe(true);
    }
  });

  it("escalationCategoryが設定されているルールは、正本§8由来の4分類のいずれかである", () => {
    const escalationRules = IMPROVEMENT_RULE_CATALOG.filter((r) => r.escalationCategory);
    expect(escalationRules.length).toBeGreaterThan(0);
    for (const rule of escalationRules) {
      expect(ESCALATION_CATEGORY_ORDER).toContain(rule.escalationCategory);
    }
  });

  it("重大リスク自動エスカレーション対象の内訳が想定どおりである(2026-09-05の4分類統合方針)", () => {
    const byCategory: Record<string, number> = {};
    for (const rule of IMPROVEMENT_RULE_CATALOG) {
      if (!rule.escalationCategory) continue;
      byCategory[rule.escalationCategory] = (byCategory[rule.escalationCategory] ?? 0) + 1;
    }
    expect(byCategory).toEqual({
      legal_medical_ad_privacy: 3,
      booking_failure: 5,
      clinic_info_mismatch: 4,
      ai_crawler_failure: 2,
    });
  });

  it("label・generatedAction・recommendedAssigneeが全項目で空文字ではない", () => {
    for (const rule of IMPROVEMENT_RULE_CATALOG) {
      expect(rule.label.length, `${rule.key}: labelが空`).toBeGreaterThan(0);
      expect(rule.generatedAction.length, `${rule.key}: generatedActionが空`).toBeGreaterThan(0);
      expect(rule.recommendedAssignee.length, `${rule.key}: recommendedAssigneeが空`).toBeGreaterThan(0);
    }
  });
});
