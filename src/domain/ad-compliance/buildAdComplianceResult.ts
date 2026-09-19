import { isEscalationEligible } from "./escalationEligibility";
import {
  AD_COMPLIANCE_DISCLAIMER,
  capSeverityForCategory,
  deriveConfidence,
  describeAdRiskMessage,
  describeConfidenceBasis,
  describeSourceLabel,
  getAdRiskCategoryDefinition,
  isProvisionalSourceType,
} from "./riskCatalog";
import type {
  AdComplianceCheckResult,
  AdRiskCategoryKey,
  AdRiskEvidence,
  AdRiskFinding,
  AdRiskFindingSourceType,
  AdRiskMatchStrength,
  AdRiskSeverity,
  RawAdRiskFinding,
} from "./types";

/**
 * 医療広告AIチェック(P0)の中核ロジック(純粋関数のみ)。
 * providerが返した生の所見(RawAdRiskFinding[])を受け取り、以下を行う:
 * - 同一カテゴリ・同一箇所の重複整理(追加条件4)
 * - 個人情報のマスキング(review_response_piiカテゴリ、追加条件5)
 * - confidenceの機械的導出(matchStrengthから。追加条件2)
 * - severityのカテゴリ上限適用(other_general_riskはhighを持てない)
 * - 表示文言・disclaimerの付与(必須3文言。設計5節)
 * - エスカレーション可否の判定(escalationEligibility.ts)
 *
 * このファイルはdomain層のため、乱数・非決定的処理を一切持ち込まない
 * (改善TOP3ロジックのpriorityScoring.tsと同じ原則)。provider固有のロジック
 * (実際にどのテキストからどのcategoryを検出するか)はすべてprovider層の責務。
 */

// 個人情報を検査用データとして保存しない(追加条件5)ためのマスキングパターン。
// review_response_piiカテゴリのevidenceにのみ適用する(他カテゴリの本文を過剰にマスキングしないため)。
const PII_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /0\d{1,4}-\d{1,4}-\d{3,4}/g, label: "電話番号" },
  { pattern: /[A-Za-z0-9_.+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9-.]+/g, label: "メールアドレス" },
];

function maskPiiIfNeeded(category: AdRiskCategoryKey, text: string): string {
  if (category !== "review_response_pii") return text;
  let masked = text;
  for (const { pattern, label } of PII_PATTERNS) {
    masked = masked.replace(pattern, `[個人情報を検出: ${label}]`);
  }
  return masked;
}

// evidenceの引用は一定の長さで切り詰める(過度な本文保持を避ける)
const MAX_QUOTED_TEXT_LENGTH = 120;

function truncateQuotedText(text: string): string {
  return text.length > MAX_QUOTED_TEXT_LENGTH ? `${text.slice(0, MAX_QUOTED_TEXT_LENGTH)}…` : text;
}

/** 重複整理(追加条件4)のグループ化キー: 同一カテゴリ・同一箇所は同一リスクとして扱う */
function dedupKey(raw: RawAdRiskFinding): string {
  return `${raw.category}:${raw.sourceLocation}`;
}

const SEVERITY_RANK: Record<AdRiskSeverity, number> = { high: 0, medium: 1, low: 2 };
const MATCH_STRENGTH_RANK: Record<AdRiskMatchStrength, number> = { direct: 0, partial: 1, inferred: 2 };

function strongestSeverity(items: RawAdRiskFinding[]): AdRiskSeverity {
  return items.reduce((best, cur) => (SEVERITY_RANK[cur.severity] < SEVERITY_RANK[best] ? cur.severity : best), items[0]!.severity);
}

function strongestMatchStrength(items: RawAdRiskFinding[]): AdRiskMatchStrength {
  return items.reduce(
    (best, cur) => (MATCH_STRENGTH_RANK[cur.matchStrength] < MATCH_STRENGTH_RANK[best] ? cur.matchStrength : best),
    items[0]!.matchStrength
  );
}

/**
 * 重複整理(dedup)される同一グループ内に、mockと非mockのevidenceが混在した場合の代表sourceTypeを
 * 決める(2026-09-05の再修正指示)。
 *
 * 確定ルール:
 * - 非mockのevidenceが1件でも存在する → mockは判定根拠から除外し、非mockのevidenceのみで
 *   severity/matchStrength/confidence/escalationを評価する(buildAdComplianceResult側で実施)。
 *   代表sourceTypeは、判定に採用した非mock evidenceのうちmatchStrengthが最も強いものを採用する
 *   (=どの実測evidenceが severity/confidence を決めたかと矛盾しない値になる)。
 * - 非mockのevidenceが1件も存在しない(=全件mock) → sourceType="mock"、provisional=trueとする。
 *
 * 「mockが1件でも混ざれば全体をmock扱いにする」という前回の保守的すぎるマージルールは撤回した。
 * mockは実測データの判定根拠を汚染してはならないが、実測のevidenceが存在するにもかかわらず
 * finding全体を(escalation不可の)mock扱いにしてしまうと、実際の重大リスクを見逃すことになるため。
 * P0では公開型を広げすぎないため代表値は単一sourceTypeとするが、evidence単位のsourceTypeは
 * AdRiskEvidence.sourceTypeとして個別に保持する。
 */
function representativeSourceType(nonMockItems: RawAdRiskFinding[]): AdRiskFindingSourceType {
  return nonMockItems.reduce(
    (best, cur) => (MATCH_STRENGTH_RANK[cur.matchStrength] < MATCH_STRENGTH_RANK[best.matchStrength] ? cur : best),
    nonMockItems[0]!
  ).sourceType;
}

const CATEGORY_DISPLAY_ORDER: AdRiskCategoryKey[] = [
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

function compareFindings(a: AdRiskFinding, b: AdRiskFinding): number {
  const severityDiff = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  if (severityDiff !== 0) return severityDiff;
  if (a.escalationEligible !== b.escalationEligible) return a.escalationEligible ? -1 : 1;
  const categoryDiff = CATEGORY_DISPLAY_ORDER.indexOf(a.category) - CATEGORY_DISPLAY_ORDER.indexOf(b.category);
  if (categoryDiff !== 0) return categoryDiff;
  return a.id.localeCompare(b.id);
}

/**
 * providerの生所見から、最終的なAdComplianceCheckResultを組み立てる。
 * findings=[]でも(=所見なし)正常に動作する(runFreeDiagnosisとの結合テストで確認)。
 */
export function buildAdComplianceResult(rawFindings: RawAdRiskFinding[], checkedAt: string): AdComplianceCheckResult {
  const groups = new Map<string, RawAdRiskFinding[]>();
  for (const raw of rawFindings) {
    const key = dedupKey(raw);
    const group = groups.get(key) ?? [];
    group.push(raw);
    groups.set(key, group);
  }

  const findings: AdRiskFinding[] = [];
  let sequence = 0;
  for (const [key, group] of groups) {
    sequence += 1;
    const category = group[0]!.category;

    // 2026-09-05の再修正指示: mockは実測データの判定根拠を「汚染」してはいけない。
    // 非mockのevidenceが1件でも存在する場合、severity/matchStrength/confidenceは
    // 非mockのevidenceのみから評価する(mock evidenceは判定に一切使わない=confidenceを
    // 上げる材料にもしない)。全件mockの場合のみ、mockのevidenceで評価する。
    const nonMockItems = group.filter((item) => item.sourceType !== "mock");
    const hasNonMockEvidence = nonMockItems.length > 0;
    const judgingItems = hasNonMockEvidence ? nonMockItems : group;

    const rawSeverity = strongestSeverity(judgingItems);
    const severity = capSeverityForCategory(category, rawSeverity);
    const matchStrength = strongestMatchStrength(judgingItems);
    const confidence = deriveConfidence(matchStrength);
    // 非mockのevidenceが1件でもあれば、そのfinding全体をmock扱いにはしない(provisional=falseになる)。
    // 全件mockの場合のみsourceType="mock"(provisional=true)とする。
    const sourceType = hasNonMockEvidence ? representativeSourceType(nonMockItems) : "mock";
    const escalationEligible = isEscalationEligible({ severity, confidence, sourceType });
    const categoryDef = getAdRiskCategoryDefinition(category);

    // evidence自体は(mock混在時も含め)全件を保持する。ただしseverity/confidenceの判定には
    // 使わない。個々のevidenceがmock由来か否かはAdRiskEvidence.sourceTypeで個別に判別できる
    // (2026-09-05の再修正指示 4: evidence単位でsourceTypeを保持し、単一値へ無理に潰さない)。
    const evidence: AdRiskEvidence[] = group.map((raw) => ({
      category: raw.category,
      quotedText: maskPiiIfNeeded(raw.category, truncateQuotedText(raw.quotedText)),
      sourceLocation: raw.sourceLocation,
      detectionReason: raw.detectionReason,
      sourceType: raw.sourceType,
    }));

    findings.push({
      id: `${category}#${sequence}`,
      category,
      severity,
      confidence,
      matchStrength,
      confidenceBasis: describeConfidenceBasis(matchStrength),
      evidence,
      mergedOccurrenceCount: group.length,
      displayMessage: describeAdRiskMessage(severity, escalationEligible),
      requiresReviewBy: categoryDef.defaultRequiresReviewBy,
      escalationEligible,
      sourceType,
      provisional: isProvisionalSourceType(sourceType),
      sourceLabel: describeSourceLabel(sourceType),
    });
    void key;
  }

  findings.sort(compareFindings);

  return {
    findings,
    disclaimer: AD_COMPLIANCE_DISCLAIMER,
    checkedAt,
  };
}
