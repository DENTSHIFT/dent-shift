import type { AdRiskConfidence, AdRiskFindingSourceType, AdRiskSeverity } from "./types";

/**
 * severity × confidence × sourceType の組み合わせから、改善TOP3への強制エスカレーション対象に
 * なり得るかを判定する独立関数(2026-09-05のユーザー指示 追加条件7: 単体でunit test可能にする)。
 *
 * 確定ルール:
 * - sourceType="mock"(開発用の擬似乱数シナリオ由来)                    → 常にfalse
 *   (2026-09-05のユーザー指示: mock由来の医療広告リスクを、実際の医院に対する重大リスクとして
 *   TOP3へ入れることは許可しない。severity/confidenceがどれだけ高くても対象外とする)
 * - sourceType!="mock" かつ severity="high" かつ confidence="high"|"medium"(confidence十分) → true
 * - sourceType!="mock" かつ severity="high" かつ confidence="low"(confidence不十分)        → false(「要確認」止まり)
 * - severity="medium"|"low"(confidenceを問わず)                                          → false
 *
 * 「confidence十分」をhigh/mediumの2段階、「不十分」をlowのみとしたのは、
 * mock provider段階ではlowが「パターンに直接一致しない・自由記述の所見」を意味するため
 * (riskCatalog.ts の deriveConfidence 参照)、この段階でTOP3という最も目立つ場所へ
 * 断定的に押し出すのは「違反断定ではなくリスクチェック」という前提に反すると判断したため。
 */
export function isEscalationEligible(finding: {
  severity: AdRiskSeverity;
  confidence: AdRiskConfidence;
  sourceType: AdRiskFindingSourceType;
}): boolean {
  if (finding.sourceType === "mock") return false;
  if (finding.severity !== "high") return false;
  return finding.confidence === "high" || finding.confidence === "medium";
}
