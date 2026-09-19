import type {
  AdRiskCategoryKey,
  AdRiskConfidence,
  AdRiskFindingSourceType,
  AdRiskMatchStrength,
  AdRiskSeverity,
} from "./types";

/**
 * 医療広告AIチェック(P0)の検出カテゴリ・表示文言の唯一の情報源(single source of truth)。
 * candidateCatalog.ts(改善TOP3の45項目カタログ)と同じ「唯一の情報源」パターンを踏襲する。
 *
 * 正本§13.1の9項目を、判定・表示の粒度を上げるため11分類に対応させている
 * (2026-09-05のユーザー指示。正本項目の分割であり範囲の追加ではない)。
 */

export interface AdRiskCategoryDefinition {
  key: AdRiskCategoryKey;
  label: string;
  /** 正本§13.1のどの項目に対応するか(監査・トレーサビリティ用) */
  sourceRef: string;
  /** 院長・法務確認の要否(正本§13.2)。デフォルトの確認推奨主体 */
  defaultRequiresReviewBy: string;
  /** false の場合、このカテゴリの所見は severity: "high" を持てない(未分類の受け皿を重大リスク扱いしないため) */
  allowHighSeverity: boolean;
}

export const AD_RISK_CATEGORY_CATALOG: AdRiskCategoryDefinition[] = [
  {
    key: "superlative_exaggeration",
    label: "最上級・誇大表現",
    sourceRef: "正本§13.1: 比較優良・最上級表現(前半)",
    defaultRequiresReviewBy: "院長",
    allowHighSeverity: true,
  },
  {
    key: "comparative_superiority",
    label: "比較優良表示",
    sourceRef: "正本§13.1: 比較優良・最上級表現(後半)",
    defaultRequiresReviewBy: "院長",
    allowHighSeverity: true,
  },
  {
    key: "safety_assertion",
    label: "安全性の断定",
    sourceRef: "正本§13.1: 効果・安全性の断定(前半)",
    defaultRequiresReviewBy: "院長",
    allowHighSeverity: true,
  },
  {
    key: "efficacy_assertion",
    label: "効果の断定",
    sourceRef: "正本§13.1: 効果・安全性の断定(後半)",
    defaultRequiresReviewBy: "院長",
    allowHighSeverity: true,
  },
  {
    key: "unfounded_numbers",
    label: "根拠のない数値",
    sourceRef: "正本§13.1: 根拠のない数値",
    defaultRequiresReviewBy: "院長",
    allowHighSeverity: true,
  },
  {
    key: "self_pay_disclosure_gap",
    label: "自費診療の費用・期間・リスク等の情報不足",
    sourceRef: "正本§13.1: 費用・期間・リスクの不足/自由診療の必要事項不足",
    defaultRequiresReviewBy: "院長／制作会社",
    allowHighSeverity: true,
  },
  {
    key: "patient_testimonial",
    label: "患者体験談の広告利用",
    sourceRef: "正本§13.1: 患者体験談の広告利用",
    defaultRequiresReviewBy: "院長",
    allowHighSeverity: true,
  },
  {
    key: "before_after_gap",
    label: "ビフォーアフターの説明不足",
    sourceRef: "正本§13.1: ビフォーアフターの説明不足",
    defaultRequiresReviewBy: "院長／制作会社",
    allowHighSeverity: true,
  },
  {
    key: "review_incentive",
    label: "口コミインセンティブ・選別依頼",
    sourceRef: "正本§13.1: 口コミインセンティブ、選別依頼",
    defaultRequiresReviewBy: "院長",
    allowHighSeverity: true,
  },
  {
    key: "review_response_pii",
    label: "個人情報を含む口コミ返信",
    sourceRef: "正本§13.1: 個人情報を含む口コミ返信",
    defaultRequiresReviewBy: "院長",
    allowHighSeverity: true,
  },
  {
    key: "other_general_risk",
    label: "その他、歯科医院サイトで重要な医療広告上のリスク",
    sourceRef: "正本に明記なし(将来のカテゴリ追加の受け皿として新設)",
    defaultRequiresReviewBy: "院長",
    allowHighSeverity: false,
  },
];

const CATEGORY_BY_KEY = new Map(AD_RISK_CATEGORY_CATALOG.map((c) => [c.key, c]));

export function getAdRiskCategoryDefinition(key: AdRiskCategoryKey): AdRiskCategoryDefinition {
  const def = CATEGORY_BY_KEY.get(key);
  if (!def) {
    throw new Error(`ad-compliance: 未定義のcategory "${key}" が指定されました`);
  }
  return def;
}

/**
 * severityがカテゴリの許容範囲を超えないよう補正する(other_general_riskはhighを持てない)。
 * providerの出力を無条件に信頼せず、ドメイン層で不変条件として強制する。
 */
export function capSeverityForCategory(category: AdRiskCategoryKey, severity: AdRiskSeverity): AdRiskSeverity {
  const def = getAdRiskCategoryDefinition(category);
  if (!def.allowHighSeverity && severity === "high") {
    return "medium";
  }
  return severity;
}

/**
 * confidenceはmatchStrengthからのみ機械的に導出する(追加条件2)。
 * providerが「evidence不足なのに高いconfidenceを主張する」ことを構造的に防ぐ。
 */
const MATCH_STRENGTH_TO_CONFIDENCE: Record<AdRiskMatchStrength, AdRiskConfidence> = {
  direct: "high",
  partial: "medium",
  inferred: "low",
};

export function deriveConfidence(matchStrength: AdRiskMatchStrength): AdRiskConfidence {
  return MATCH_STRENGTH_TO_CONFIDENCE[matchStrength];
}

const CONFIDENCE_BASIS_TEXT: Record<AdRiskMatchStrength, string> = {
  direct: "既知の禁止表現パターンに直接一致したため",
  partial: "パターンの部分一致・文脈依存の判断であり、確度はやや間接的です",
  inferred: "既知パターンに直接一致せず、AIの所感に基づく参考所見です",
};

export function describeConfidenceBasis(matchStrength: AdRiskMatchStrength): string {
  return CONFIDENCE_BASIS_TEXT[matchStrength];
}

/**
 * sourceType="mock"(開発用の擬似乱数シナリオ由来)のみをprovisional(開発用サンプル・実測ではない)として
 * 扱う(2026-09-05のユーザー指示)。この判定はescalationEligibility.tsのisEscalationEligibleと
 * buildAdComplianceResult.tsの両方から参照される単一の情報源であり、
 * 「mock由来かどうか」の判断がファイルごとにばらつくことを防ぐ。
 */
const PROVISIONAL_SOURCE_TYPES: ReadonlySet<AdRiskFindingSourceType> = new Set(["mock"]);

export function isProvisionalSourceType(sourceType: AdRiskFindingSourceType): boolean {
  return PROVISIONAL_SOURCE_TYPES.has(sourceType);
}

/**
 * 所見の由来を人が読める形で示す固定文言。無料診断結果に含めた場合でも、
 * mock由来(開発用サンプル)か実際の検出結果かを機械的に判別できるようにする
 * (2026-09-05のユーザー指示 追加条件4: 「開発用サンプル」「実測ではない」と判別できる状態にする)。
 */
const SOURCE_LABEL_TEXT: Record<AdRiskFindingSourceType, string> = {
  mock: "開発用サンプル(実測ではありません)",
  rule_based: "実際の入力に基づく検出結果",
  live_page: "実際の入力に基づく検出結果(ページ本文)",
  review_text: "実際の入力に基づく検出結果(口コミ返信テキスト)",
  ai_provider: "実際の入力に基づく検出結果(AIプロバイダー)",
};

export function describeSourceLabel(sourceType: AdRiskFindingSourceType): string {
  return SOURCE_LABEL_TEXT[sourceType];
}

/**
 * 5節で必須とした3文言。表示文言・disclaimerのすべてに含まれることをunit testで検証する。
 * 「AIによるリスクチェック」であり「法令違反を断定するもの」ではないことを常に明示する(追加条件1)。
 */
export const AD_COMPLIANCE_MANDATORY_PHRASES = [
  "AIによるリスクチェック",
  "法令違反を断定するものではありません",
  "最終判断は医院または専門家が行ってください",
] as const;

export const AD_COMPLIANCE_DISCLAIMER =
  "これはAIによるリスクチェックであり、法令違反を断定するものではありません。最終判断は医院または専門家が行ってください。";

/**
 * severity × エスカレーション可否の組み合わせに応じた固定表示文言を生成する。
 * 「違反(いはん)」という語は、否定形の必須フレーズ「法令違反を断定するものではありません」の中でのみ
 * 使用し、それ以外の場所では一切使わない(=違反を断定する表現を作らない)。
 * 上位層はこの関数を経由してのみ表示文言を得る(文言の自由合成を許さない)。
 */
export function describeAdRiskMessage(severity: AdRiskSeverity, escalationEligible: boolean): string {
  if (severity === "high" && escalationEligible) {
    return (
      "AIによるリスクチェック: 重大な医療広告リスクの可能性があります。" +
      "法令違反を断定するものではありません。最終判断は医院または専門家が行ってください。" +
      "早めのご確認をおすすめします。"
    );
  }
  if (severity === "high" && !escalationEligible) {
    return (
      "AIによるリスクチェック(要確認): 重大なリスクの可能性がありますが、確度が十分ではないため断定していません。" +
      "法令違反を断定するものではありません。最終判断は医院または専門家が行ってください。"
    );
  }
  if (severity === "medium") {
    return (
      "AIによるリスクチェック: 表現の見直しをおすすめします。" +
      "法令違反を断定するものではありません。最終判断は医院または専門家が行ってください。"
    );
  }
  return (
    "AIによるリスクチェック: 念のためご確認をおすすめします。" +
    "法令違反を断定するものではありません。最終判断は医院または専門家が行ってください。"
  );
}
