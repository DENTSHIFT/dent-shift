/**
 * 医療広告AIチェック(P0)のドメイン型。
 * 正本§13(医療広告・コンプライアンスチェック)に基づく(docs/MEDICAL_AD_AI_CHECK_DESIGN_2026-09-05.md)。
 *
 * 重要な前提(2026-09-05 設計確定): DENT SHIFTは法律判断を行わない。
 * この機能は「AIによるリスクチェック」であり「法令違反を断定するもの」ではない。
 * 最終判断は医院または専門家が行う。この前提はriskCatalog.tsの表示文言テンプレートで
 * 機械的に強制し(必須3文言)、unit testで検証する(追加条件1)。
 */

export type AdRiskCategoryKey =
  | "superlative_exaggeration"
  | "comparative_superiority"
  | "safety_assertion"
  | "efficacy_assertion"
  | "unfounded_numbers"
  | "self_pay_disclosure_gap"
  | "patient_testimonial"
  | "before_after_gap"
  | "review_incentive"
  | "review_response_pii"
  | "other_general_risk";

/** 3段階。既存改善TOP3の EscalationSeverity("critical"|"high")とは別の型として定義する(設計4節)。 */
export type AdRiskSeverity = "high" | "medium" | "low";

/** 3段階。severityとは独立して持たせる(6節: confidenceが低くても所見自体は必ず表示する)。 */
export type AdRiskConfidence = "high" | "medium" | "low";

/**
 * 検出根拠の強さ(追加条件2・3対応)。
 * confidenceはこの値からのみ機械的に導出し(riskCatalog.ts の deriveConfidence)、
 * providerが直接confidenceを主張することを許さない。
 * これにより「evidence不足時に推測でhigh confidenceにする」ことを構造的に防ぐ。
 * - "direct": 既知の禁止表現パターンに直接一致
 * - "partial": パターンの部分一致・文脈依存でやや間接的
 * - "inferred": providerの自由記述所見(パターンマッチによらない、最も弱い根拠)
 */
export type AdRiskMatchStrength = "direct" | "partial" | "inferred";

/**
 * この所見がどこから来たか(2026-09-05のユーザー指示: mock由来のfindingを実測と区別するため追加)。
 * - "mock": 開発用の擬似乱数シナリオ(MockAdComplianceProvider の MOCK_SCENARIOS)由来。実データではない。
 * - "rule_based": 実際の入力テキストに対する決定論的なパターン検出(乱数を用いない)。
 * - "live_page": 実際にクロールしたページ本文からの検出(将来のprovider実装向け)。
 * - "review_text": 実際の口コミ返信テキストからの検出(現状はPII検出のみがこれに該当)。
 * - "ai_provider": 将来、LLM等のAIプロバイダーによる分類結果。
 *
 * "mock"のみをprovisional(開発用サンプル・実測ではない)として扱う(escalationEligibility.ts /
 * riskCatalog.ts の isProvisionalSourceType 参照)。sourceType="mock"の所見は、severity/confidenceが
 * どれだけ高くても改善TOP3への強制エスカレーション対象にはならない(追加条件: mock由来のリスクを
 * 実際の医院に対する重大リスクとして扱わない)。
 */
export type AdRiskFindingSourceType = "mock" | "rule_based" | "live_page" | "review_text" | "ai_provider";

/**
 * provider層が返す生の所見(ドメイン層による確度導出・PIIマスキング・重複整理より前の状態)。
 * severityはカテゴリの性質そのものに関する評価としてproviderが付与するが、
 * confidenceはドメイン層がmatchStrengthから導出する(providerはconfidenceを直接主張しない)。
 */
export interface RawAdRiskFinding {
  category: AdRiskCategoryKey;
  severity: AdRiskSeverity;
  matchStrength: AdRiskMatchStrength;
  /** 該当箇所の引用(マスキング前)。review_response_piiではドメイン層でマスキングされる */
  quotedText: string;
  sourceLocation: string;
  detectionReason: string;
  /** この所見の由来(必須)。providerは自身が生成した所見の由来を必ず申告する */
  sourceType: AdRiskFindingSourceType;
}

export interface AdRiskEvidence {
  category: AdRiskCategoryKey;
  /** 該当箇所の引用。review_response_piiカテゴリではマスキング済みの文字列になる(追加条件5) */
  quotedText: string;
  sourceLocation: string;
  detectionReason: string;
  /**
   * このevidence1件ごとの由来(2026-09-05の再修正指示: 単一sourceTypeへ無理に潰さず、
   * evidence単位でsourceTypeを保持する)。同一findingにmockと非mockのevidenceが混在する場合、
   * このフィールドでどのevidenceがmock(開発用サンプル)かを個別に判別できる。
   */
  sourceType: AdRiskFindingSourceType;
}

/**
 * ドメイン層で確度導出・PIIマスキング・同一箇所の重複整理(追加条件4)を経た最終的な所見。
 * 「違反(violation)」を意味するフィールド・真偽値は一切持たせない(設計5節)。
 */
export interface AdRiskFinding {
  id: string;
  category: AdRiskCategoryKey;
  severity: AdRiskSeverity;
  confidence: AdRiskConfidence;
  /** confidenceがどのmatchStrengthから導出されたか(追加条件3: confidenceの根拠を保持) */
  matchStrength: AdRiskMatchStrength;
  /** 確度の根拠を人が読める形で保持したもの(追加条件3) */
  confidenceBasis: string;
  /** 同一カテゴリ・同一箇所で検出された所見をまとめたもの(重複整理後は1件以上) */
  evidence: AdRiskEvidence[];
  /** 重複整理により何件の所見が統合されたか(追加条件4) */
  mergedOccurrenceCount: number;
  /** 表示用の固定テンプレート文言(必須3文言を含む。設計5節) */
  displayMessage: string;
  /** 院長・専門家等、確認を推奨する主体(正本§13.2「院長・法務確認の要否」に対応) */
  requiresReviewBy: string;
  /** 改善TOP3への強制エスカレーション対象になり得るか(escalationEligibility.tsのisEscalationEligibleの結果) */
  escalationEligible: boolean;
  /**
   * この所見の代表sourceType(2026-09-05の再修正指示)。
   * 重複整理で複数所見が統合される際、非mockのevidenceが1件でも存在すればそのfinding全体を
   * mock扱いにはしない(mockが実測データを汚染することを防ぐ)。全evidenceがmockの場合のみ"mock"。
   * 個々のevidenceの由来はAdRiskEvidence.sourceTypeで個別に保持する(buildAdComplianceResult.ts参照)。
   */
  sourceType: AdRiskFindingSourceType;
  /** 非mockのevidenceが1件も存在しない場合のみtrue(開発用サンプルのみ・実測ではない)。escalationEligibleがtrueになることはない */
  provisional: boolean;
  /** provisionalかどうかを人が読める形で示す固定文言(riskCatalog.tsのdescribeSourceLabel由来) */
  sourceLabel: string;
}

export interface AdComplianceCheckResult {
  findings: AdRiskFinding[];
  /** 追加条件1: risk detected ≠ 法令違反確定、を明示する固定免責文言 */
  disclaimer: string;
  checkedAt: string;
}
