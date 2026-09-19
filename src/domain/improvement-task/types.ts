import type { CriterionEvidence, DomainKey, UnavailableReason } from "../diagnosis/types";

/**
 * 改善TOP3生成ロジック(正本: docs/source/DENT_SHIFT_AI改善アクション生成ロジック_Ver1.pdf)。
 *
 * 設計方針(2026-09-05 承認分):
 * - 4軸(集患インパクト/緊急性/実行容易性/波及効果)は各0-5点、重み付けなしの単純合計(0-20点)。
 *   将来的な重み付けconfiguration化に備え、軸ごとのスコアを構造化して保持する(priorityScoring.ts参照)。
 * - 重大リスクの自動エスカレーションは20点ランキングとは別枠。20点満点への無理な変換はしない
 *   (escalationはescalationフィールド、通常の4軸スコアはpriorityフィールドとして両方保持する)。
 * - insufficient_data/unavailable(データ不足)は「医院の弱点」として推測採点しない。
 *   dataGapフィールドで区別し、診断・予約計測を重大に阻害する場合のみTOP3に入り得る。
 *
 * 既存UI(src/app/diagnosis/result/[id]/page.tsx)は
 * title/detectedFact/patientImpact/recommendedAction/impact/confidence/urgency/evidence(string[])
 * を直接参照しているため、これらのフィールドは後方互換のため維持し、
 * 新ロジックの実体は追加フィールド(kind/priority/escalation/dataGap/structuredEvidence等)に持たせる。
 * legacyDisplayFields()(priorityScoring.ts)が新ロジックからこれらの表示互換値を導出する。
 */

// 後方互換: 既存UIが直接読む3値ラベル。新ロジックの4軸スコア/escalation/dataGapから導出表示する。
export type ImpactLevel = "high" | "medium" | "low";

/** 正本§8の5分類を、2026-09-05のユーザー指示で4分類に統合したもの(優先順位順)。 */
export type EscalationCategory =
  | "legal_medical_ad_privacy" // 1. 法令・医療広告・個人情報等の重大リスク
  | "booking_failure" // 2. 予約不能・予約導線の重大障害(計測障害を含む)
  | "clinic_info_mismatch" // 3. 医院基本情報の重大な不一致
  | "ai_crawler_failure"; // 4. AI/検索クローラーの重大障害

export const ESCALATION_CATEGORY_ORDER: EscalationCategory[] = [
  "legal_medical_ad_privacy",
  "booking_failure",
  "clinic_info_mismatch",
  "ai_crawler_failure",
];

export type EscalationSeverity = "critical" | "high";
export type EscalationConfidence = "high" | "medium";

/** 重大リスクの自動エスカレーション情報。20点ランキングとは独立して保持する。 */
export interface EscalationInfo {
  category: EscalationCategory;
  severity: EscalationSeverity;
  confidence: EscalationConfidence;
  reason: string;
}

export type PriorityTier = "top" | "priority" | "normal" | "monitor";

/** 4軸(集患インパクト/緊急性/実行容易性/波及効果)、各0-5点。P0では重み付けをしない。 */
export interface PriorityAxisScores {
  catchmentImpact: number;
  urgency: number;
  easeOfExecution: number;
  rippleEffect: number;
}

/** 4軸の単純合計(0-20点)による優先度スコア。 */
export interface PriorityScore {
  axes: PriorityAxisScores;
  total: number;
  tier: PriorityTier;
}

export type DataGapStatus = "unavailable" | "insufficient_data";

/**
 * データ不足(measured/estimatedな判断ができない状態)を表す。
 * 「医院の弱点」ではなく「まず確認・接続・計測が必要な状態」として扱う。
 */
export interface DataGapInfo {
  status: DataGapStatus;
  reason: string;
  /**
   * 機械可読な理由(2026-09-06のユーザー指示④)。status==="insufficient_data"のときは常に
   * "insufficient_data"。status==="unavailable"のときは、根拠となったcriterion/質問結果が
   * 既に持つunavailableReasonをそのまま引き継ぐ(この候補生成ロジック自身が新たに理由を
   * 主張することはしない)。
   */
  unavailableReason: UnavailableReason;
  // 診断や予約計測そのものを重大に阻害する場合のみtrue(この場合のみTOP3候補になり得る)
  blocking: boolean;
}

export type ImprovementCandidateKind = "risk_escalation" | "data_gap" | "standard";

export interface ImprovementCandidate {
  // --- 既存UI互換フィールド(変更しない) ---
  // domainはUI互換のため維持する「表示上の領域」(=displayDomainと同義)。
  // 新ロジックでは表示領域と診断根拠の領域を意図的に分離しており、根拠側はevidenceDomainを見ること。
  title: string;
  domain: DomainKey;
  detectedFact: string;
  patientImpact: string;
  recommendedAction: string;
  impact: ImpactLevel;
  confidence: ImpactLevel;
  urgency: ImpactLevel;
  evidence: string[];

  // --- 新ロジック本体 ---
  /** candidateCatalogのkeyと同一(質問結果由来など、カタログ外のcandidateは専用のkeyを振る) */
  key: string;
  kind: ImprovementCandidateKind;
  recommendedAssignee: string;
  /** 監査・トレーサビリティ用の識別子(scoreCriteria.tsのruleKey命名規則に合わせる) */
  ruleKey: string;
  /**
   * 診断根拠の同一性を表す鍵(`${evidenceDomain}:${criterionKey}`が基本形)。
   * 同じrootCauseKeyを持つstandard種別の候補は、TOP3選定前に1件の代表へ集約される
   * (deduplicateByRootCause()、risk_escalationは対象外)。
   * カタログ外(data_gap/質問結果由来)の候補は、独立した根拠を持つため他候補と衝突しない
   * 専用の値を振る(例: `data-gap:${domain}`、`adhoc:${key}`)。
   */
  rootCauseKey: string;
  /**
   * 診断根拠(criterion)が属する領域。displayDomain(=domainフィールド)とは意図的に分離しており、
   * 両者が異なること(cross-domain)自体は不具合ではない。
   */
  evidenceDomain: DomainKey;
  /**
   * 正本45項目カタログとscoreCriteria.tsの対応関係が正式仕様として未確定であることを示す。
   * candidateCatalog.ts由来の45項目はtrue。data_gap・質問結果由来など、
   * カタログのcriterion対応マッピングに依存しない候補はfalse。
   */
  provisional: boolean;
  /** このcandidateの根拠となったdomain/criterionの組(正本§1.3「影響するスコア領域」に対応) */
  sourceCriteria: Array<{ domain: DomainKey; criterionKey: string }>;
  /** 構造化evidence(正本§10の修正指示書生成やUIの将来拡張で使うための非破壊フィールド) */
  structuredEvidence: CriterionEvidence[];
  /** kind !== "data_gap" のとき必ず設定される */
  priority?: PriorityScore;
  /** kind === "risk_escalation" のときのみ設定される */
  escalation?: EscalationInfo;
  /** kind === "data_gap" のときのみ設定される */
  dataGap?: DataGapInfo;
}
