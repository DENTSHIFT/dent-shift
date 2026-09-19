import type { DomainKey } from "../diagnosis/types";
import type { EscalationCategory } from "./types";

/**
 * 正本(docs/source/DENT_SHIFT_AI改善アクション生成ロジック_Ver1.pdf §2〜7)の
 * 検出カタログ(AIO7・LLMO6・MEO7・SEO7・Web予約導線10・口コミ8 = 計45項目)の
 * 唯一の情報源(single source of truth)。
 *
 * 【重要な既知の制約(P0/Ver1時点)】
 * 正本の「スコア診断ロジック」(6領域×5サブ項目=30criterion)と「改善アクション生成ロジック」
 * (45項目の検出カタログ)は別文書であり、両者の対応関係は正本内に明記されていない。
 * 本カタログの45項目はすべて「暫定マッピング」(provisional: true)であり、
 * DENT SHIFTの正式仕様として固定されたものではない(2026-09-05のユーザー指示)。
 * 実データ・正式な対応表が確定した項目から、provisionalを個別にfalseへ更新できる。
 *
 * 【2026-09-05の構造再整理(1回限りの再構成)】
 * - diagnosticAnchor は「この候補が主に参照する評価根拠」を示す1つのcriterionであり、
 *   「これが低ければ必ずこの改善項目が発火する」という唯一の発火条件ではない
 *   (発火条件そのものはtriggerRules[]が担う。P0ではtriggerRulesはdiagnosticAnchorに対する
 *   単一条件のみを持つが、将来的に複数条件のAND評価へ拡張できる構造にしてある)。
 * - evidenceRequirements[] は「この候補を生成してよいか」の可用性ゲートを表す
 *   (対象criterionがunavailableな場合、fabricateした独立シグナルで代替して発火させることはしない)。
 * - displayDomain(ユーザーに表示する領域)とevidenceDomain(診断根拠のcriterionが属する領域)は
 *   意図的に分離している。両者が異なる項目(cross-domain)は不具合ではなく、
 *   「AIO向けの表示だがLLMO側のcriterionを根拠にする」といった正当な設計として扱う。
 * - rootCauseKey(`${evidenceDomain}:${criterionKey}`)は、同一の診断根拠を共有する
 *   standard種別の候補を、TOP3選定前にdeduplicateByRootCause()で1件の代表へ集約するための鍵。
 *   重大リスクエスカレーション(risk_escalation)はこの重複整理の対象外(常に優先表示される)。
 *
 * 各ルールの4軸評価根拠(catalogPriority/recommendedAssignee/rippleHint)から
 * priorityScoring.ts が集患インパクト/緊急性/実行容易性/波及効果を機械的に算出する
 * (数値をここに直接書かないことで「なぜこの点数か」を追跡可能にする)。
 */

export type CatalogPriority = "urgent" | "top" | "high" | "normal";
export type RippleHint = "narrow" | "moderate" | "wide";

export interface CriterionRef {
  domain: DomainKey;
  criterionKey: string;
}

/** 発火条件の比較演算子。P0では「達成率がthreshold未満」のみをサポートする。 */
export type TriggerComparator = "ratio_below";

/**
 * 発火条件の1条件。triggerRules[]は複数要素をAND評価する(P0では要素数1のみ実在するが、
 * 将来「複数criterionが同時に悪いときだけ発火」といった条件を追加できる構造にしてある)。
 */
export interface TriggerRule {
  criterion: CriterionRef;
  comparator: TriggerComparator;
  /** ratio_belowの場合: criterionの達成率(0〜1)がこの値未満で条件を満たす */
  threshold: number;
}

/**
 * この候補を生成してよいかの可用性ゲート。列挙されたcriterionのいずれかがunavailableな場合、
 * この候補は生成しない(data_gap側で別途表現する。推測で独立シグナルを捏造して発火させない)。
 */
export interface EvidenceRequirement {
  criterion: CriterionRef;
  description: string;
}

export interface ImprovementRuleDefinition {
  /** カタログ内で一意。ImprovementCandidate.keyにそのまま使う */
  key: string;
  /** 監査・トレーサビリティ用(scoreCriteria.tsのruleKey命名規則に合わせる) */
  ruleKey: string;
  /**
   * 診断根拠の同一性を表す鍵(`${evidenceDomain}:${criterionKey}`)。
   * 同じrootCauseKeyを持つstandard種別の候補は、TOP3選定前に1件の代表へ集約される
   * (deduplicateByRootCause()、risk_escalationは対象外)。
   */
  rootCauseKey: string;
  /** ユーザーに表示する領域(正本カタログの章)。evidenceDomainと異なる場合がある(cross-domain) */
  displayDomain: DomainKey;
  /** 診断根拠(diagnosticAnchor / triggerRules / evidenceRequirements)が属する領域 */
  evidenceDomain: DomainKey;
  /** 検出内容(正本の表記) */
  label: string;
  /** 生成アクション(正本の表記) */
  generatedAction: string;
  /** 推奨担当(正本の表記) */
  recommendedAssignee: string;
  /** 正本カタログの優先度列(緊急/最優先/高/通常) */
  catalogPriority: CatalogPriority;
  /** 波及効果の根拠(複数領域に影響するほどwide) */
  rippleHint: RippleHint;
  /**
   * この候補が主に参照する評価根拠(1つのcriterion)。
   * 唯一の発火条件ではない(発火条件はtriggerRules[]、可用性ゲートはevidenceRequirements[]が担う)。
   * 監査・表示用の「代表的な根拠」として保持する。
   */
  diagnosticAnchor: CriterionRef;
  /** 発火条件(AND評価)。P0ではdiagnosticAnchorに対する単一条件のみ */
  triggerRules: TriggerRule[];
  /** 生成可否の可用性ゲート。P0ではdiagnosticAnchorのみが対象 */
  evidenceRequirements: EvidenceRequirement[];
  /** 正本§8の重大リスク自動エスカレーション対象の場合のみ設定 */
  escalationCategory?: EscalationCategory;
  /**
   * 正本45項目とscoreCriteria.ts(30criterion)の対応関係が正式仕様として未確定であることを示す。
   * 2026-09-05時点では45項目すべてtrue。実データ・正式対応表で検証できた項目から個別にfalseへ更新する。
   */
  provisional: boolean;
}

export const IMPROVEMENT_RULE_CATALOG: ImprovementRuleDefinition[] = [
  // ===== AIO(正本§2、7項目) =====
  {
    key: "aio-basic-info-mismatch",
    ruleKey: "improvement-logic:2-basic_info_mismatch",
    rootCauseKey: "AIO:information_accuracy",
    displayDomain: "AIO",
    evidenceDomain: "AIO",
    label: "医院基本情報がページごとに不一致",
    generatedAction: "医院名・住所・電話・診療時間を統一",
    recommendedAssignee: "医院／制作会社",
    catalogPriority: "top",
    rippleHint: "wide",
    diagnosticAnchor: { domain: "AIO", criterionKey: "information_accuracy" },
    triggerRules: [
      { criterion: { domain: "AIO", criterionKey: "information_accuracy" }, comparator: "ratio_below", threshold: 0.34 },
    ],
    evidenceRequirements: [
      { criterion: { domain: "AIO", criterionKey: "information_accuracy" }, description: "医院基本情報がページごとに不一致の判定に用いる情報の正確性のデータ" },
    ],
    escalationCategory: "clinic_info_mismatch",
    provisional: true,
  },
  {
    key: "aio-abstract-treatment-desc",
    ruleKey: "improvement-logic:2-abstract_treatment_desc",
    rootCauseKey: "AIO:question_domain_coverage",
    displayDomain: "AIO",
    evidenceDomain: "AIO",
    label: "診療内容の説明が抽象的",
    generatedAction: "治療対象・方法・期間・費用・リスクを構造化",
    recommendedAssignee: "院長／制作会社",
    catalogPriority: "high",
    rippleHint: "moderate",
    diagnosticAnchor: { domain: "AIO", criterionKey: "question_domain_coverage" },
    triggerRules: [
      { criterion: { domain: "AIO", criterionKey: "question_domain_coverage" }, comparator: "ratio_below", threshold: 0.6 },
    ],
    evidenceRequirements: [
      { criterion: { domain: "AIO", criterionKey: "question_domain_coverage" }, description: "診療内容の説明が抽象的の判定に用いる質問領域の広さのデータ" },
    ],
    provisional: true,
  },
  {
    key: "aio-faq-missing",
    ruleKey: "improvement-logic:2-faq_missing",
    rootCauseKey: "AIO:citation_acquisition",
    displayDomain: "AIO",
    evidenceDomain: "AIO",
    label: "FAQが不足",
    generatedAction: "患者の質問を意図別FAQとして追加",
    recommendedAssignee: "医院／制作会社",
    catalogPriority: "high",
    rippleHint: "narrow",
    diagnosticAnchor: { domain: "AIO", criterionKey: "citation_acquisition" },
    triggerRules: [
      { criterion: { domain: "AIO", criterionKey: "citation_acquisition" }, comparator: "ratio_below", threshold: 0.6 },
    ],
    evidenceRequirements: [
      { criterion: { domain: "AIO", criterionKey: "citation_acquisition" }, description: "FAQが不足の判定に用いる引用・リンク獲得のデータ" },
    ],
    provisional: true,
  },
  {
    key: "aio-doctor-info-missing",
    ruleKey: "improvement-logic:2-doctor_info_missing",
    rootCauseKey: "AIO:information_accuracy",
    displayDomain: "AIO",
    evidenceDomain: "AIO",
    label: "医師情報・監修者が不明",
    generatedAction: "経歴・資格・所属・監修情報を明示",
    recommendedAssignee: "院長",
    catalogPriority: "high",
    rippleHint: "narrow",
    diagnosticAnchor: { domain: "AIO", criterionKey: "information_accuracy" },
    triggerRules: [
      { criterion: { domain: "AIO", criterionKey: "information_accuracy" }, comparator: "ratio_below", threshold: 0.6 },
    ],
    evidenceRequirements: [
      { criterion: { domain: "AIO", criterionKey: "information_accuracy" }, description: "医師情報・監修者が不明の判定に用いる情報の正確性のデータ" },
    ],
    provisional: true,
  },
  {
    key: "aio-structured-data-missing",
    ruleKey: "improvement-logic:2-structured_data_missing",
    rootCauseKey: "LLMO:structured_data",
    displayDomain: "AIO",
    evidenceDomain: "LLMO",
    label: "構造化データが不足",
    generatedAction: "Organization・Dentist・FAQ等を適切に実装",
    recommendedAssignee: "制作会社",
    catalogPriority: "high",
    rippleHint: "moderate",
    diagnosticAnchor: { domain: "LLMO", criterionKey: "structured_data" },
    triggerRules: [
      { criterion: { domain: "LLMO", criterionKey: "structured_data" }, comparator: "ratio_below", threshold: 0.6 },
    ],
    evidenceRequirements: [
      { criterion: { domain: "LLMO", criterionKey: "structured_data" }, description: "構造化データが不足の判定に用いる構造化データのデータ" },
    ],
    provisional: true,
  },
  {
    key: "aio-update-date-unclear",
    ruleKey: "improvement-logic:2-update_date_unclear",
    rootCauseKey: "LLMO:content_provenance",
    displayDomain: "AIO",
    evidenceDomain: "LLMO",
    label: "更新日・根拠が不明",
    generatedAction: "更新日、監修者、参照根拠を明示",
    recommendedAssignee: "医院／制作会社",
    catalogPriority: "normal",
    rippleHint: "narrow",
    diagnosticAnchor: { domain: "LLMO", criterionKey: "content_provenance" },
    triggerRules: [
      { criterion: { domain: "LLMO", criterionKey: "content_provenance" }, comparator: "ratio_below", threshold: 0.6 },
    ],
    evidenceRequirements: [
      { criterion: { domain: "LLMO", criterionKey: "content_provenance" }, description: "更新日・根拠が不明の判定に用いる情報の根拠・更新性のデータ" },
    ],
    provisional: true,
  },
  {
    key: "aio-crawl-blocked",
    ruleKey: "improvement-logic:2-crawl_blocked",
    rootCauseKey: "LLMO:crawler_access",
    displayDomain: "AIO",
    evidenceDomain: "LLMO",
    label: "クロール阻害・重要情報が画像のみ",
    generatedAction: "テキスト化とアクセス可能性を改善",
    recommendedAssignee: "制作会社",
    catalogPriority: "top",
    rippleHint: "wide",
    diagnosticAnchor: { domain: "LLMO", criterionKey: "crawler_access" },
    triggerRules: [
      { criterion: { domain: "LLMO", criterionKey: "crawler_access" }, comparator: "ratio_below", threshold: 0.34 },
    ],
    evidenceRequirements: [
      { criterion: { domain: "LLMO", criterionKey: "crawler_access" }, description: "クロール阻害・重要情報が画像のみの判定に用いるAIクローラーのアクセスのデータ" },
    ],
    escalationCategory: "ai_crawler_failure",
    provisional: true,
  },

  // ===== LLMO(正本§3、6項目) =====
  {
    key: "llmo-generic-only",
    ruleKey: "improvement-logic:3-generic_only",
    rootCauseKey: "LLMO:content_clarity",
    displayDomain: "LLMO",
    evidenceDomain: "LLMO",
    label: "医院の特徴が一般論のみ",
    generatedAction: "設備・体制・対応範囲など検証可能な独自情報を追加",
    recommendedAssignee: "院長",
    catalogPriority: "high",
    rippleHint: "moderate",
    diagnosticAnchor: { domain: "LLMO", criterionKey: "content_clarity" },
    triggerRules: [
      { criterion: { domain: "LLMO", criterionKey: "content_clarity" }, comparator: "ratio_below", threshold: 0.6 },
    ],
    evidenceRequirements: [
      { criterion: { domain: "LLMO", criterionKey: "content_clarity" }, description: "医院の特徴が一般論のみの判定に用いるコンテンツの理解しやすさのデータ" },
    ],
    provisional: true,
  },
  {
    key: "llmo-entity-ambiguous",
    ruleKey: "improvement-logic:3-entity_ambiguous",
    rootCauseKey: "LLMO:info_consistency",
    displayDomain: "LLMO",
    evidenceDomain: "LLMO",
    label: "エンティティ情報が曖昧",
    generatedAction: "医院・医師・診療領域の関係を一貫させる",
    recommendedAssignee: "制作会社",
    catalogPriority: "high",
    rippleHint: "moderate",
    diagnosticAnchor: { domain: "LLMO", criterionKey: "info_consistency" },
    triggerRules: [
      { criterion: { domain: "LLMO", criterionKey: "info_consistency" }, comparator: "ratio_below", threshold: 0.6 },
    ],
    evidenceRequirements: [
      { criterion: { domain: "LLMO", criterionKey: "info_consistency" }, description: "エンティティ情報が曖昧の判定に用いる医院情報の一貫性のデータ" },
    ],
    provisional: true,
  },
  {
    key: "llmo-third-party-evidence-missing",
    ruleKey: "improvement-logic:3-third_party_evidence_missing",
    rootCauseKey: "LLMO:content_provenance",
    displayDomain: "LLMO",
    evidenceDomain: "LLMO",
    label: "第三者根拠が不足",
    generatedAction: "公的情報・所属団体・一次情報への参照を整備",
    recommendedAssignee: "医院",
    catalogPriority: "normal",
    rippleHint: "narrow",
    diagnosticAnchor: { domain: "LLMO", criterionKey: "content_provenance" },
    triggerRules: [
      { criterion: { domain: "LLMO", criterionKey: "content_provenance" }, comparator: "ratio_below", threshold: 0.6 },
    ],
    evidenceRequirements: [
      { criterion: { domain: "LLMO", criterionKey: "content_provenance" }, description: "第三者根拠が不足の判定に用いる情報の根拠・更新性のデータ" },
    ],
    provisional: true,
  },
  {
    key: "llmo-no-direct-answer",
    ruleKey: "improvement-logic:3-no_direct_answer",
    rootCauseKey: "AIO:question_domain_coverage",
    displayDomain: "LLMO",
    evidenceDomain: "AIO",
    label: "質問に対する直接回答がない",
    generatedAction: "患者質問ごとに短い要約回答を追加",
    recommendedAssignee: "制作会社",
    catalogPriority: "high",
    rippleHint: "moderate",
    diagnosticAnchor: { domain: "AIO", criterionKey: "question_domain_coverage" },
    triggerRules: [
      { criterion: { domain: "AIO", criterionKey: "question_domain_coverage" }, comparator: "ratio_below", threshold: 0.6 },
    ],
    evidenceRequirements: [
      { criterion: { domain: "AIO", criterionKey: "question_domain_coverage" }, description: "質問に対する直接回答がないの判定に用いる質問領域の広さのデータ" },
    ],
    provisional: true,
  },
  {
    key: "llmo-no-comparison-info",
    ruleKey: "improvement-logic:3-no_comparison_info",
    rootCauseKey: "LLMO:content_clarity",
    displayDomain: "LLMO",
    evidenceDomain: "LLMO",
    label: "比較・選び方情報がない",
    generatedAction: "適応・非適応、選択基準を中立的に説明",
    recommendedAssignee: "院長／制作会社",
    catalogPriority: "normal",
    rippleHint: "narrow",
    diagnosticAnchor: { domain: "LLMO", criterionKey: "content_clarity" },
    triggerRules: [
      { criterion: { domain: "LLMO", criterionKey: "content_clarity" }, comparator: "ratio_below", threshold: 0.6 },
    ],
    evidenceRequirements: [
      { criterion: { domain: "LLMO", criterionKey: "content_clarity" }, description: "比較・選び方情報がないの判定に用いるコンテンツの理解しやすさのデータ" },
    ],
    provisional: true,
  },
  {
    key: "llmo-info-outdated-conflicting",
    ruleKey: "improvement-logic:3-info_outdated_conflicting",
    rootCauseKey: "LLMO:info_consistency",
    displayDomain: "LLMO",
    evidenceDomain: "LLMO",
    label: "情報が古い・矛盾",
    generatedAction: "更新確認とサイト・GBP・外部媒体の整合",
    recommendedAssignee: "医院",
    catalogPriority: "top",
    rippleHint: "wide",
    diagnosticAnchor: { domain: "LLMO", criterionKey: "info_consistency" },
    triggerRules: [
      { criterion: { domain: "LLMO", criterionKey: "info_consistency" }, comparator: "ratio_below", threshold: 0.34 },
    ],
    evidenceRequirements: [
      { criterion: { domain: "LLMO", criterionKey: "info_consistency" }, description: "情報が古い・矛盾の判定に用いる医院情報の一貫性のデータ" },
    ],
    escalationCategory: "clinic_info_mismatch",
    provisional: true,
  },

  // ===== MEO(正本§4、7項目) =====
  {
    key: "meo-nap-mismatch",
    ruleKey: "improvement-logic:4-nap_mismatch",
    rootCauseKey: "MEO:gbp_basic_safety",
    displayDomain: "MEO",
    evidenceDomain: "MEO",
    label: "NAP情報が不一致",
    generatedAction: "名称・住所・電話を全媒体で統一",
    recommendedAssignee: "医院",
    catalogPriority: "top",
    rippleHint: "wide",
    diagnosticAnchor: { domain: "MEO", criterionKey: "gbp_basic_safety" },
    triggerRules: [
      { criterion: { domain: "MEO", criterionKey: "gbp_basic_safety" }, comparator: "ratio_below", threshold: 0.34 },
    ],
    evidenceRequirements: [
      { criterion: { domain: "MEO", criterionKey: "gbp_basic_safety" }, description: "NAP情報が不一致の判定に用いる基本設定・安全性のデータ" },
    ],
    escalationCategory: "clinic_info_mismatch",
    provisional: true,
  },
  {
    key: "meo-hours-outdated",
    ruleKey: "improvement-logic:4-hours_outdated",
    rootCauseKey: "MEO:gbp_content_richness",
    displayDomain: "MEO",
    evidenceDomain: "MEO",
    label: "診療時間・休診情報が古い",
    generatedAction: "通常・祝日・臨時休診を更新",
    recommendedAssignee: "医院",
    catalogPriority: "top",
    rippleHint: "wide",
    diagnosticAnchor: { domain: "MEO", criterionKey: "gbp_content_richness" },
    triggerRules: [
      { criterion: { domain: "MEO", criterionKey: "gbp_content_richness" }, comparator: "ratio_below", threshold: 0.34 },
    ],
    evidenceRequirements: [
      { criterion: { domain: "MEO", criterionKey: "gbp_content_richness" }, description: "診療時間・休診情報が古いの判定に用いる情報・診療内容の充実のデータ" },
    ],
    escalationCategory: "clinic_info_mismatch",
    provisional: true,
  },
  {
    key: "meo-category-mismatch",
    ruleKey: "improvement-logic:4-category_mismatch",
    rootCauseKey: "MEO:map_visibility",
    displayDomain: "MEO",
    evidenceDomain: "MEO",
    label: "主カテゴリ・副カテゴリが不適切",
    generatedAction: "診療実態に沿って再設定",
    recommendedAssignee: "医院",
    catalogPriority: "high",
    rippleHint: "moderate",
    diagnosticAnchor: { domain: "MEO", criterionKey: "map_visibility" },
    triggerRules: [
      { criterion: { domain: "MEO", criterionKey: "map_visibility" }, comparator: "ratio_below", threshold: 0.6 },
    ],
    evidenceRequirements: [
      { criterion: { domain: "MEO", criterionKey: "map_visibility" }, description: "主カテゴリ・副カテゴリが不適切の判定に用いるGoogleマップ表示状況のデータ" },
    ],
    provisional: true,
  },
  {
    key: "meo-service-info-missing",
    ruleKey: "improvement-logic:4-service_info_missing",
    rootCauseKey: "MEO:gbp_content_richness",
    displayDomain: "MEO",
    evidenceDomain: "MEO",
    label: "サービス情報が不足",
    generatedAction: "主要診療項目と説明を登録",
    recommendedAssignee: "医院",
    catalogPriority: "high",
    rippleHint: "narrow",
    diagnosticAnchor: { domain: "MEO", criterionKey: "gbp_content_richness" },
    triggerRules: [
      { criterion: { domain: "MEO", criterionKey: "gbp_content_richness" }, comparator: "ratio_below", threshold: 0.6 },
    ],
    evidenceRequirements: [
      { criterion: { domain: "MEO", criterionKey: "gbp_content_richness" }, description: "サービス情報が不足の判定に用いる情報・診療内容の充実のデータ" },
    ],
    provisional: true,
  },
  {
    key: "meo-photos-scarce-old",
    ruleKey: "improvement-logic:4-photos_scarce_old",
    rootCauseKey: "MEO:photo_activity",
    displayDomain: "MEO",
    evidenceDomain: "MEO",
    label: "写真が少ない・古い",
    generatedAction: "外観・院内・設備・スタッフ写真を更新",
    recommendedAssignee: "医院",
    catalogPriority: "normal",
    rippleHint: "narrow",
    diagnosticAnchor: { domain: "MEO", criterionKey: "photo_activity" },
    triggerRules: [
      { criterion: { domain: "MEO", criterionKey: "photo_activity" }, comparator: "ratio_below", threshold: 0.6 },
    ],
    evidenceRequirements: [
      { criterion: { domain: "MEO", criterionKey: "photo_activity" }, description: "写真が少ない・古いの判定に用いる情報発信・写真の運用のデータ" },
    ],
    provisional: true,
  },
  {
    key: "meo-booking-link-broken",
    ruleKey: "improvement-logic:4-booking_link_broken",
    rootCauseKey: "MEO:booking_funnel_meo",
    displayDomain: "MEO",
    evidenceDomain: "MEO",
    label: "予約リンク切れ・誤誘導",
    generatedAction: "正しい予約URLへ修正し動作確認",
    recommendedAssignee: "医院／制作会社",
    catalogPriority: "top",
    rippleHint: "moderate",
    diagnosticAnchor: { domain: "MEO", criterionKey: "booking_funnel_meo" },
    triggerRules: [
      { criterion: { domain: "MEO", criterionKey: "booking_funnel_meo" }, comparator: "ratio_below", threshold: 0.34 },
    ],
    evidenceRequirements: [
      { criterion: { domain: "MEO", criterionKey: "booking_funnel_meo" }, description: "予約リンク切れ・誤誘導の判定に用いる来院・予約への導線のデータ" },
    ],
    escalationCategory: "booking_failure",
    provisional: true,
  },
  {
    key: "meo-posts-qa-neglected",
    ruleKey: "improvement-logic:4-posts_qa_neglected",
    rootCauseKey: "MEO:photo_activity",
    displayDomain: "MEO",
    evidenceDomain: "MEO",
    label: "投稿・Q&Aが放置",
    generatedAction: "重要情報の定期更新とQ&A整備",
    recommendedAssignee: "医院",
    catalogPriority: "normal",
    rippleHint: "narrow",
    diagnosticAnchor: { domain: "MEO", criterionKey: "photo_activity" },
    triggerRules: [
      { criterion: { domain: "MEO", criterionKey: "photo_activity" }, comparator: "ratio_below", threshold: 0.6 },
    ],
    evidenceRequirements: [
      { criterion: { domain: "MEO", criterionKey: "photo_activity" }, description: "投稿・Q&Aが放置の判定に用いる情報発信・写真の運用のデータ" },
    ],
    provisional: true,
  },

  // ===== SEO(正本§5、7項目) =====
  {
    key: "seo-index-noindex-issue",
    ruleKey: "improvement-logic:5-index_noindex_issue",
    rootCauseKey: "SEO:crawl_index",
    displayDomain: "SEO",
    evidenceDomain: "SEO",
    label: "index/noindex設定の不備",
    generatedAction: "重要ページの登録可否を点検・修正",
    recommendedAssignee: "制作会社",
    catalogPriority: "top",
    rippleHint: "wide",
    diagnosticAnchor: { domain: "SEO", criterionKey: "crawl_index" },
    triggerRules: [
      { criterion: { domain: "SEO", criterionKey: "crawl_index" }, comparator: "ratio_below", threshold: 0.34 },
    ],
    evidenceRequirements: [
      { criterion: { domain: "SEO", criterionKey: "crawl_index" }, description: "index/noindex設定の不備の判定に用いるクロール・インデックスのデータ" },
    ],
    escalationCategory: "ai_crawler_failure",
    provisional: true,
  },
  {
    key: "seo-title-heading-duplicate",
    ruleKey: "improvement-logic:5-title_heading_duplicate",
    rootCauseKey: "SEO:site_structure",
    displayDomain: "SEO",
    evidenceDomain: "SEO",
    label: "タイトル・見出しの重複",
    generatedAction: "ページ目的ごとに固有化",
    recommendedAssignee: "制作会社",
    catalogPriority: "high",
    rippleHint: "narrow",
    diagnosticAnchor: { domain: "SEO", criterionKey: "site_structure" },
    triggerRules: [
      { criterion: { domain: "SEO", criterionKey: "site_structure" }, comparator: "ratio_below", threshold: 0.6 },
    ],
    evidenceRequirements: [
      { criterion: { domain: "SEO", criterionKey: "site_structure" }, description: "タイトル・見出しの重複の判定に用いるサイト構造・ページ設定のデータ" },
    ],
    provisional: true,
  },
  {
    key: "seo-thin-treatment-pages",
    ruleKey: "improvement-logic:5-thin_treatment_pages",
    rootCauseKey: "SEO:content_quality",
    displayDomain: "SEO",
    evidenceDomain: "SEO",
    label: "診療ページが薄い",
    generatedAction: "症状・治療・費用・期間・リスクを拡充",
    recommendedAssignee: "院長／制作会社",
    catalogPriority: "high",
    rippleHint: "moderate",
    diagnosticAnchor: { domain: "SEO", criterionKey: "content_quality" },
    triggerRules: [
      { criterion: { domain: "SEO", criterionKey: "content_quality" }, comparator: "ratio_below", threshold: 0.6 },
    ],
    evidenceRequirements: [
      { criterion: { domain: "SEO", criterionKey: "content_quality" }, description: "診療ページが薄いの判定に用いる診療コンテンツの品質のデータ" },
    ],
    provisional: true,
  },
  {
    key: "seo-internal-links-missing",
    ruleKey: "improvement-logic:5-internal_links_missing",
    rootCauseKey: "SEO:site_structure",
    displayDomain: "SEO",
    evidenceDomain: "SEO",
    label: "内部リンクが不足",
    generatedAction: "症状・治療・料金・予約への導線を接続",
    recommendedAssignee: "制作会社",
    catalogPriority: "normal",
    rippleHint: "moderate",
    diagnosticAnchor: { domain: "SEO", criterionKey: "site_structure" },
    triggerRules: [
      { criterion: { domain: "SEO", criterionKey: "site_structure" }, comparator: "ratio_below", threshold: 0.6 },
    ],
    evidenceRequirements: [
      { criterion: { domain: "SEO", criterionKey: "site_structure" }, description: "内部リンクが不足の判定に用いるサイト構造・ページ設定のデータ" },
    ],
    provisional: true,
  },
  {
    key: "seo-slow-mobile-performance",
    ruleKey: "improvement-logic:5-slow_mobile_performance",
    rootCauseKey: "SEO:mobile_experience",
    displayDomain: "SEO",
    evidenceDomain: "SEO",
    label: "表示速度・モバイル性能が低い",
    generatedAction: "画像・スクリプト・レイアウトを最適化",
    recommendedAssignee: "制作会社",
    catalogPriority: "high",
    rippleHint: "narrow",
    diagnosticAnchor: { domain: "SEO", criterionKey: "mobile_experience" },
    triggerRules: [
      { criterion: { domain: "SEO", criterionKey: "mobile_experience" }, comparator: "ratio_below", threshold: 0.6 },
    ],
    evidenceRequirements: [
      { criterion: { domain: "SEO", criterionKey: "mobile_experience" }, description: "表示速度・モバイル性能が低いの判定に用いるスマホ・表示体験のデータ" },
    ],
    provisional: true,
  },
  {
    key: "seo-duplicate-canonical",
    ruleKey: "improvement-logic:5-duplicate_canonical",
    rootCauseKey: "SEO:site_structure",
    displayDomain: "SEO",
    evidenceDomain: "SEO",
    label: "重複URL・canonical不備",
    generatedAction: "正規URLを統一",
    recommendedAssignee: "制作会社",
    catalogPriority: "high",
    rippleHint: "narrow",
    diagnosticAnchor: { domain: "SEO", criterionKey: "site_structure" },
    triggerRules: [
      { criterion: { domain: "SEO", criterionKey: "site_structure" }, comparator: "ratio_below", threshold: 0.6 },
    ],
    evidenceRequirements: [
      { criterion: { domain: "SEO", criterionKey: "site_structure" }, description: "重複URL・canonical不備の判定に用いるサイト構造・ページ設定のデータ" },
    ],
    provisional: true,
  },
  {
    key: "seo-measurement-incomplete",
    ruleKey: "improvement-logic:5-measurement_incomplete",
    rootCauseKey: "SEO:search_performance",
    displayDomain: "SEO",
    evidenceDomain: "SEO",
    label: "計測環境が不完全",
    generatedAction: "Search Console・GA4の設定を確認",
    recommendedAssignee: "制作会社",
    catalogPriority: "high",
    rippleHint: "narrow",
    diagnosticAnchor: { domain: "SEO", criterionKey: "search_performance" },
    triggerRules: [
      { criterion: { domain: "SEO", criterionKey: "search_performance" }, comparator: "ratio_below", threshold: 0.6 },
    ],
    evidenceRequirements: [
      { criterion: { domain: "SEO", criterionKey: "search_performance" }, description: "計測環境が不完全の判定に用いる検索での表示・流入実績のデータ" },
    ],
    provisional: true,
  },

  // ===== WEB_BOOKING(正本§6、10項目) =====
  {
    key: "booking-link-broken",
    ruleKey: "improvement-logic:6-link_broken",
    rootCauseKey: "WEB_BOOKING:booking_funnel_flow",
    displayDomain: "WEB_BOOKING",
    evidenceDomain: "WEB_BOOKING",
    label: "予約リンク切れ・遷移先誤り",
    generatedAction: "全デバイスでリンク先を修正・検証",
    recommendedAssignee: "制作会社",
    catalogPriority: "top",
    rippleHint: "wide",
    diagnosticAnchor: { domain: "WEB_BOOKING", criterionKey: "booking_funnel_flow" },
    triggerRules: [
      { criterion: { domain: "WEB_BOOKING", criterionKey: "booking_funnel_flow" }, comparator: "ratio_below", threshold: 0.34 },
    ],
    evidenceRequirements: [
      { criterion: { domain: "WEB_BOOKING", criterionKey: "booking_funnel_flow" }, description: "予約リンク切れ・遷移先誤りの判定に用いる予約・問い合わせ導線のデータ" },
    ],
    escalationCategory: "booking_failure",
    provisional: true,
  },
  {
    key: "booking-phone-invalid",
    ruleKey: "improvement-logic:6-phone_invalid",
    rootCauseKey: "WEB_BOOKING:booking_funnel_flow",
    displayDomain: "WEB_BOOKING",
    evidenceDomain: "WEB_BOOKING",
    label: "電話番号が誤り・タップ不可",
    generatedAction: "番号修正とtelリンク設定",
    recommendedAssignee: "制作会社",
    catalogPriority: "top",
    rippleHint: "moderate",
    diagnosticAnchor: { domain: "WEB_BOOKING", criterionKey: "booking_funnel_flow" },
    triggerRules: [
      { criterion: { domain: "WEB_BOOKING", criterionKey: "booking_funnel_flow" }, comparator: "ratio_below", threshold: 0.34 },
    ],
    evidenceRequirements: [
      { criterion: { domain: "WEB_BOOKING", criterionKey: "booking_funnel_flow" }, description: "電話番号が誤り・タップ不可の判定に用いる予約・問い合わせ導線のデータ" },
    ],
    escalationCategory: "booking_failure",
    provisional: true,
  },
  {
    key: "booking-form-error",
    ruleKey: "improvement-logic:6-form_error",
    rootCauseKey: "WEB_BOOKING:form_usability",
    displayDomain: "WEB_BOOKING",
    evidenceDomain: "WEB_BOOKING",
    label: "フォーム送信エラー",
    generatedAction: "入力・送信・通知・完了画面を復旧",
    recommendedAssignee: "制作会社",
    catalogPriority: "top",
    rippleHint: "wide",
    diagnosticAnchor: { domain: "WEB_BOOKING", criterionKey: "form_usability" },
    triggerRules: [
      { criterion: { domain: "WEB_BOOKING", criterionKey: "form_usability" }, comparator: "ratio_below", threshold: 0.34 },
    ],
    evidenceRequirements: [
      { criterion: { domain: "WEB_BOOKING", criterionKey: "form_usability" }, description: "フォーム送信エラーの判定に用いる予約フォームの使いやすさのデータ" },
    ],
    escalationCategory: "booking_failure",
    provisional: true,
  },
  {
    key: "booking-no-cv-measurement",
    ruleKey: "improvement-logic:6-no_cv_measurement",
    rootCauseKey: "WEB_BOOKING:measurement_setup",
    displayDomain: "WEB_BOOKING",
    evidenceDomain: "WEB_BOOKING",
    label: "CV計測がない",
    generatedAction: "予約完了・電話・LINE等のイベントを設定",
    recommendedAssignee: "制作会社",
    catalogPriority: "top",
    rippleHint: "wide",
    diagnosticAnchor: { domain: "WEB_BOOKING", criterionKey: "measurement_setup" },
    triggerRules: [
      { criterion: { domain: "WEB_BOOKING", criterionKey: "measurement_setup" }, comparator: "ratio_below", threshold: 0.34 },
    ],
    evidenceRequirements: [
      { criterion: { domain: "WEB_BOOKING", criterionKey: "measurement_setup" }, description: "CV計測がないの判定に用いる計測・改善環境のデータ" },
    ],
    escalationCategory: "booking_failure",
    provisional: true,
  },
  {
    key: "booking-cta-hard-to-find",
    ruleKey: "improvement-logic:6-cta_hard_to_find",
    rootCauseKey: "WEB_BOOKING:purpose_match",
    displayDomain: "WEB_BOOKING",
    evidenceDomain: "WEB_BOOKING",
    label: "予約CTAが見つけにくい",
    generatedAction: "ファーストビューと追従部に明確なCTAを配置",
    recommendedAssignee: "制作会社",
    catalogPriority: "high",
    rippleHint: "moderate",
    diagnosticAnchor: { domain: "WEB_BOOKING", criterionKey: "purpose_match" },
    triggerRules: [
      { criterion: { domain: "WEB_BOOKING", criterionKey: "purpose_match" }, comparator: "ratio_below", threshold: 0.6 },
    ],
    evidenceRequirements: [
      { criterion: { domain: "WEB_BOOKING", criterionKey: "purpose_match" }, description: "予約CTAが見つけにくいの判定に用いる来院目的との一致のデータ" },
    ],
    provisional: true,
  },
  {
    key: "booking-too-many-steps",
    ruleKey: "improvement-logic:6-too_many_steps",
    rootCauseKey: "WEB_BOOKING:booking_funnel_flow",
    displayDomain: "WEB_BOOKING",
    evidenceDomain: "WEB_BOOKING",
    label: "予約までの階層が長い",
    generatedAction: "最短導線へ短縮",
    recommendedAssignee: "制作会社",
    catalogPriority: "high",
    rippleHint: "moderate",
    diagnosticAnchor: { domain: "WEB_BOOKING", criterionKey: "booking_funnel_flow" },
    triggerRules: [
      { criterion: { domain: "WEB_BOOKING", criterionKey: "booking_funnel_flow" }, comparator: "ratio_below", threshold: 0.6 },
    ],
    evidenceRequirements: [
      { criterion: { domain: "WEB_BOOKING", criterionKey: "booking_funnel_flow" }, description: "予約までの階層が長いの判定に用いる予約・問い合わせ導線のデータ" },
    ],
    provisional: true,
  },
  {
    key: "booking-too-many-fields",
    ruleKey: "improvement-logic:6-too_many_fields",
    rootCauseKey: "WEB_BOOKING:form_usability",
    displayDomain: "WEB_BOOKING",
    evidenceDomain: "WEB_BOOKING",
    label: "入力項目が多い",
    generatedAction: "必須項目を最小化",
    recommendedAssignee: "医院／制作会社",
    catalogPriority: "high",
    rippleHint: "narrow",
    diagnosticAnchor: { domain: "WEB_BOOKING", criterionKey: "form_usability" },
    triggerRules: [
      { criterion: { domain: "WEB_BOOKING", criterionKey: "form_usability" }, comparator: "ratio_below", threshold: 0.6 },
    ],
    evidenceRequirements: [
      { criterion: { domain: "WEB_BOOKING", criterionKey: "form_usability" }, description: "入力項目が多いの判定に用いる予約フォームの使いやすさのデータ" },
    ],
    provisional: true,
  },
  {
    key: "booking-no-auto-reply",
    ruleKey: "improvement-logic:6-no_auto_reply",
    rootCauseKey: "WEB_BOOKING:pre_booking_reassurance",
    displayDomain: "WEB_BOOKING",
    evidenceDomain: "WEB_BOOKING",
    label: "自動返信がない",
    generatedAction: "受付完了と次の流れを自動送信",
    recommendedAssignee: "制作会社",
    catalogPriority: "normal",
    rippleHint: "narrow",
    diagnosticAnchor: { domain: "WEB_BOOKING", criterionKey: "pre_booking_reassurance" },
    triggerRules: [
      { criterion: { domain: "WEB_BOOKING", criterionKey: "pre_booking_reassurance" }, comparator: "ratio_below", threshold: 0.6 },
    ],
    evidenceRequirements: [
      { criterion: { domain: "WEB_BOOKING", criterionKey: "pre_booking_reassurance" }, description: "自動返信がないの判定に用いる予約前の不安解消のデータ" },
    ],
    provisional: true,
  },
  {
    key: "booking-info-insufficient",
    ruleKey: "improvement-logic:6-info_insufficient",
    rootCauseKey: "WEB_BOOKING:pre_booking_reassurance",
    displayDomain: "WEB_BOOKING",
    evidenceDomain: "WEB_BOOKING",
    label: "料金・アクセス・持ち物が不足",
    generatedAction: "予約前の不安情報を追加",
    recommendedAssignee: "医院／制作会社",
    catalogPriority: "normal",
    rippleHint: "narrow",
    diagnosticAnchor: { domain: "WEB_BOOKING", criterionKey: "pre_booking_reassurance" },
    triggerRules: [
      { criterion: { domain: "WEB_BOOKING", criterionKey: "pre_booking_reassurance" }, comparator: "ratio_below", threshold: 0.6 },
    ],
    evidenceRequirements: [
      { criterion: { domain: "WEB_BOOKING", criterionKey: "pre_booking_reassurance" }, description: "料金・アクセス・持ち物が不足の判定に用いる予約前の不安解消のデータ" },
    ],
    provisional: true,
  },
  {
    key: "booking-popup-interferes",
    ruleKey: "improvement-logic:6-popup_interferes",
    rootCauseKey: "WEB_BOOKING:form_usability",
    displayDomain: "WEB_BOOKING",
    evidenceDomain: "WEB_BOOKING",
    label: "ポップアップが操作を妨害",
    generatedAction: "表示条件・閉じる操作を改善",
    recommendedAssignee: "制作会社",
    catalogPriority: "high",
    rippleHint: "narrow",
    diagnosticAnchor: { domain: "WEB_BOOKING", criterionKey: "form_usability" },
    triggerRules: [
      { criterion: { domain: "WEB_BOOKING", criterionKey: "form_usability" }, comparator: "ratio_below", threshold: 0.6 },
    ],
    evidenceRequirements: [
      { criterion: { domain: "WEB_BOOKING", criterionKey: "form_usability" }, description: "ポップアップが操作を妨害の判定に用いる予約フォームの使いやすさのデータ" },
    ],
    provisional: true,
  },

  // ===== REVIEWS(正本§7、8項目) =====
  {
    key: "reviews-recent-scarce",
    ruleKey: "improvement-logic:7-recent_scarce",
    rootCauseKey: "REVIEWS:review_freshness",
    displayDomain: "REVIEWS",
    evidenceDomain: "REVIEWS",
    label: "直近90日の口コミが少ない",
    generatedAction: "全患者に公平な口コミ案内フローを整備",
    recommendedAssignee: "医院",
    catalogPriority: "high",
    rippleHint: "narrow",
    diagnosticAnchor: { domain: "REVIEWS", criterionKey: "review_freshness" },
    triggerRules: [
      { criterion: { domain: "REVIEWS", criterionKey: "review_freshness" }, comparator: "ratio_below", threshold: 0.6 },
    ],
    evidenceRequirements: [
      { criterion: { domain: "REVIEWS", criterionKey: "review_freshness" }, description: "直近90日の口コミが少ないの判定に用いる口コミの鮮度のデータ" },
    ],
    provisional: true,
  },
  {
    key: "reviews-no-response",
    ruleKey: "improvement-logic:7-no_response",
    rootCauseKey: "REVIEWS:response_quality",
    displayDomain: "REVIEWS",
    evidenceDomain: "REVIEWS",
    label: "口コミへの返信がない",
    generatedAction: "未返信口コミへの返信案を生成",
    recommendedAssignee: "院長／受付",
    catalogPriority: "high",
    rippleHint: "narrow",
    diagnosticAnchor: { domain: "REVIEWS", criterionKey: "response_quality" },
    triggerRules: [
      { criterion: { domain: "REVIEWS", criterionKey: "response_quality" }, comparator: "ratio_below", threshold: 0.6 },
    ],
    evidenceRequirements: [
      { criterion: { domain: "REVIEWS", criterionKey: "response_quality" }, description: "口コミへの返信がないの判定に用いる返信・患者対応のデータ" },
    ],
    provisional: true,
  },
  {
    key: "reviews-negative-neglected",
    ruleKey: "improvement-logic:7-negative_neglected",
    rootCauseKey: "REVIEWS:response_quality",
    displayDomain: "REVIEWS",
    evidenceDomain: "REVIEWS",
    label: "低評価口コミが放置",
    generatedAction: "配慮・確認・個別窓口を含む返信案を生成",
    recommendedAssignee: "院長",
    catalogPriority: "top",
    rippleHint: "moderate",
    diagnosticAnchor: { domain: "REVIEWS", criterionKey: "response_quality" },
    triggerRules: [
      { criterion: { domain: "REVIEWS", criterionKey: "response_quality" }, comparator: "ratio_below", threshold: 0.6 },
    ],
    evidenceRequirements: [
      { criterion: { domain: "REVIEWS", criterionKey: "response_quality" }, description: "低評価口コミが放置の判定に用いる返信・患者対応のデータ" },
    ],
    provisional: true,
  },
  {
    key: "reviews-response-contains-pii",
    ruleKey: "improvement-logic:7-response_contains_pii",
    rootCauseKey: "REVIEWS:policy_risk",
    displayDomain: "REVIEWS",
    evidenceDomain: "REVIEWS",
    label: "返信に個人情報を含む",
    generatedAction: "該当返信を修正・削除",
    recommendedAssignee: "院長",
    catalogPriority: "urgent",
    rippleHint: "narrow",
    diagnosticAnchor: { domain: "REVIEWS", criterionKey: "policy_risk" },
    triggerRules: [
      { criterion: { domain: "REVIEWS", criterionKey: "policy_risk" }, comparator: "ratio_below", threshold: 0.34 },
    ],
    evidenceRequirements: [
      { criterion: { domain: "REVIEWS", criterionKey: "policy_risk" }, description: "返信に個人情報を含むの判定に用いるポリシー・法令リスクのデータ" },
    ],
    escalationCategory: "legal_medical_ad_privacy",
    provisional: true,
  },
  {
    key: "reviews-recurring-complaints",
    ruleKey: "improvement-logic:7-recurring_complaints",
    rootCauseKey: "REVIEWS:review_health",
    displayDomain: "REVIEWS",
    evidenceDomain: "REVIEWS",
    label: "同じ不満が複数発生",
    generatedAction: "院内オペレーション改善タスクへ変換",
    recommendedAssignee: "院長／事務長",
    catalogPriority: "top",
    rippleHint: "moderate",
    diagnosticAnchor: { domain: "REVIEWS", criterionKey: "review_health" },
    triggerRules: [
      { criterion: { domain: "REVIEWS", criterionKey: "review_health" }, comparator: "ratio_below", threshold: 0.6 },
    ],
    evidenceRequirements: [
      { criterion: { domain: "REVIEWS", criterionKey: "review_health" }, description: "同じ不満が複数発生の判定に用いる口コミの健全性のデータ" },
    ],
    provisional: true,
  },
  {
    key: "reviews-trust-info-missing",
    ruleKey: "improvement-logic:7-trust_info_missing",
    rootCauseKey: "REVIEWS:objective_trust_info",
    displayDomain: "REVIEWS",
    evidenceDomain: "REVIEWS",
    label: "医師・料金・リスク情報が不足",
    generatedAction: "信頼情報をWebサイトへ追加",
    recommendedAssignee: "院長／制作会社",
    catalogPriority: "high",
    rippleHint: "moderate",
    diagnosticAnchor: { domain: "REVIEWS", criterionKey: "objective_trust_info" },
    triggerRules: [
      { criterion: { domain: "REVIEWS", criterionKey: "objective_trust_info" }, comparator: "ratio_below", threshold: 0.6 },
    ],
    evidenceRequirements: [
      { criterion: { domain: "REVIEWS", criterionKey: "objective_trust_info" }, description: "医師・料金・リスク情報が不足の判定に用いる客観的な信頼情報のデータ" },
    ],
    provisional: true,
  },
  {
    key: "reviews-exaggerated-claims",
    ruleKey: "improvement-logic:7-exaggerated_claims",
    rootCauseKey: "REVIEWS:policy_risk",
    displayDomain: "REVIEWS",
    evidenceDomain: "REVIEWS",
    label: "誇大・根拠のない表現",
    generatedAction: "表現を停止・修正し確認へ回す",
    recommendedAssignee: "院長／制作会社",
    catalogPriority: "urgent",
    rippleHint: "moderate",
    diagnosticAnchor: { domain: "REVIEWS", criterionKey: "policy_risk" },
    triggerRules: [
      { criterion: { domain: "REVIEWS", criterionKey: "policy_risk" }, comparator: "ratio_below", threshold: 0.34 },
    ],
    evidenceRequirements: [
      { criterion: { domain: "REVIEWS", criterionKey: "policy_risk" }, description: "誇大・根拠のない表現の判定に用いるポリシー・法令リスクのデータ" },
    ],
    escalationCategory: "legal_medical_ad_privacy",
    provisional: true,
  },
  {
    key: "reviews-incentivized-reviews",
    ruleKey: "improvement-logic:7-incentivized_reviews",
    rootCauseKey: "REVIEWS:policy_risk",
    displayDomain: "REVIEWS",
    evidenceDomain: "REVIEWS",
    label: "特典付き・選別型の口コミ依頼",
    generatedAction: "不適切な募集を停止し公平運用へ変更",
    recommendedAssignee: "院長",
    catalogPriority: "urgent",
    rippleHint: "moderate",
    diagnosticAnchor: { domain: "REVIEWS", criterionKey: "policy_risk" },
    triggerRules: [
      { criterion: { domain: "REVIEWS", criterionKey: "policy_risk" }, comparator: "ratio_below", threshold: 0.34 },
    ],
    evidenceRequirements: [
      { criterion: { domain: "REVIEWS", criterionKey: "policy_risk" }, description: "特典付き・選別型の口コミ依頼の判定に用いるポリシー・法令リスクのデータ" },
    ],
    escalationCategory: "legal_medical_ad_privacy",
    provisional: true,
  },
];

export function getImprovementRuleByKey(key: string): ImprovementRuleDefinition | undefined {
  return IMPROVEMENT_RULE_CATALOG.find((r) => r.key === key);
}
