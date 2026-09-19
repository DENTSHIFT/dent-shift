import type { DomainKey } from "./types";

/**
 * 正本「DENT_SHIFT_AI集患総合スコア診断ロジック_Ver1.pdf」§3〜9 に定義された
 * 6領域・各5サブ項目・配点の唯一の情報源(single source of truth)。
 * domain層のscoring.tsも、provider層のmockScoreProvider.tsも、この定義だけを参照する。
 *
 * 領域の並び順は診断ロジック仕様書§11「ダッシュボード表示仕様」の
 * 「AIO→LLMO→MEO→SEO→予約導線→口コミ」に合わせる。
 */
export interface CriterionDefinition {
  key: string;
  label: string;
  maxScore: number;
  // 正本のどのセクションに基づく項目かを追跡できるようにする(将来のUI/監査ログ表示用)
  ruleKey: string;
}

export const DOMAIN_ORDER: DomainKey[] = ["AIO", "LLMO", "MEO", "SEO", "WEB_BOOKING", "REVIEWS"];

export const DOMAIN_CRITERIA: Record<DomainKey, CriterionDefinition[]> = {
  AIO: [
    { key: "ai_search_presence", label: "AI検索での医院表示", maxScore: 10, ruleKey: "score-logic:4-ai_search_presence" },
    { key: "citation_acquisition", label: "引用・リンク獲得", maxScore: 6, ruleKey: "score-logic:4-citation_acquisition" },
    { key: "recommendation_rank", label: "推薦順位・露出度", maxScore: 5, ruleKey: "score-logic:4-recommendation_rank" },
    { key: "information_accuracy", label: "情報の正確性", maxScore: 5, ruleKey: "score-logic:4-information_accuracy" },
    { key: "question_domain_coverage", label: "質問領域の広さ", maxScore: 4, ruleKey: "score-logic:4-question_domain_coverage" },
  ],
  LLMO: [
    { key: "crawler_access", label: "AIクローラーのアクセス", maxScore: 3, ruleKey: "score-logic:5-crawler_access" },
    { key: "info_consistency", label: "医院情報の一貫性", maxScore: 3, ruleKey: "score-logic:5-info_consistency" },
    { key: "structured_data", label: "構造化データ", maxScore: 4, ruleKey: "score-logic:5-structured_data" },
    { key: "content_clarity", label: "コンテンツの理解しやすさ", maxScore: 3, ruleKey: "score-logic:5-content_clarity" },
    { key: "content_provenance", label: "情報の根拠・更新性", maxScore: 2, ruleKey: "score-logic:5-content_provenance" },
  ],
  MEO: [
    { key: "gbp_basic_safety", label: "基本設定・安全性", maxScore: 3, ruleKey: "score-logic:6-gbp_basic_safety" },
    { key: "gbp_content_richness", label: "情報・診療内容の充実", maxScore: 4, ruleKey: "score-logic:6-gbp_content_richness" },
    { key: "map_visibility", label: "Googleマップ表示状況", maxScore: 6, ruleKey: "score-logic:6-map_visibility" },
    { key: "photo_activity", label: "情報発信・写真の運用", maxScore: 3, ruleKey: "score-logic:6-photo_activity" },
    { key: "booking_funnel_meo", label: "来院・予約への導線", maxScore: 4, ruleKey: "score-logic:6-booking_funnel_meo" },
  ],
  SEO: [
    { key: "crawl_index", label: "クロール・インデックス", maxScore: 3, ruleKey: "score-logic:7-crawl_index" },
    { key: "site_structure", label: "サイト構造・ページ設定", maxScore: 3, ruleKey: "score-logic:7-site_structure" },
    { key: "content_quality", label: "診療コンテンツの品質", maxScore: 4, ruleKey: "score-logic:7-content_quality" },
    { key: "search_performance", label: "検索での表示・流入実績", maxScore: 3, ruleKey: "score-logic:7-search_performance" },
    { key: "mobile_experience", label: "スマホ・表示体験", maxScore: 2, ruleKey: "score-logic:7-mobile_experience" },
  ],
  WEB_BOOKING: [
    { key: "purpose_match", label: "来院目的との一致", maxScore: 2, ruleKey: "score-logic:8-purpose_match" },
    { key: "booking_funnel_flow", label: "予約・問い合わせ導線", maxScore: 2, ruleKey: "score-logic:8-booking_funnel_flow" },
    { key: "form_usability", label: "予約フォームの使いやすさ", maxScore: 3, ruleKey: "score-logic:8-form_usability" },
    { key: "pre_booking_reassurance", label: "予約前の不安解消", maxScore: 1, ruleKey: "score-logic:8-pre_booking_reassurance" },
    { key: "measurement_setup", label: "計測・改善環境", maxScore: 2, ruleKey: "score-logic:8-measurement_setup" },
  ],
  REVIEWS: [
    { key: "review_health", label: "口コミの健全性", maxScore: 3, ruleKey: "score-logic:9-review_health" },
    { key: "review_freshness", label: "口コミの鮮度", maxScore: 2, ruleKey: "score-logic:9-review_freshness" },
    { key: "response_quality", label: "返信・患者対応", maxScore: 2, ruleKey: "score-logic:9-response_quality" },
    { key: "objective_trust_info", label: "客観的な信頼情報", maxScore: 2, ruleKey: "score-logic:9-objective_trust_info" },
    { key: "policy_risk", label: "ポリシー・法令リスク", maxScore: 1, ruleKey: "score-logic:9-policy_risk" },
  ],
};

export function getDomainMaxPoints(domain: DomainKey): number {
  return DOMAIN_CRITERIA[domain].reduce((sum, c) => sum + c.maxScore, 0);
}

export function getTotalMaxPoints(): number {
  return DOMAIN_ORDER.reduce((sum, d) => sum + getDomainMaxPoints(d), 0);
}
