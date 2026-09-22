export const PLAN_IDS = ["light", "standard", "premium"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export interface PlanSummary {
  id: PlanId;
  name: string;
  description: string;
  recommended: boolean;
  highlights: readonly string[];
}

export interface PlanFeatureRow {
  feature: string;
  light: string;
  standard: string;
  premium: string;
}

export const PLAN_SUMMARIES: readonly PlanSummary[] = [
  {
    id: "light",
    name: "ライトプラン",
    description: "まずは毎月の状態確認と、優先改善TOP3から始める医院向け",
    recommended: false,
    highlights: ["6領域スコア：月次", "対象AI：主要2種", "競合医院：3院", "改善タスク：TOP3"],
  },
  {
    id: "standard",
    name: "スタンダードプラン",
    description: "週次で改善を進め、AI流入・予約まで継続的に確認したい医院向け",
    recommended: true,
    highlights: ["6領域スコア：週次", "対象AI：5種", "競合医院：10院", "改善タスク：無制限"],
  },
  {
    id: "premium",
    name: "プレミアムプラン",
    description: "詳細分析と専門家レビューを含め、集患改善を加速したい医院向け",
    recommended: false,
    highlights: ["日次・週次サマリー", "競合医院：20院", "詳細ヒートマップ分析", "月1回の継続面談"],
  },
] as const;

// 既存の機能要件定義書「18. プラン別機能案」を表示用の唯一の情報源へ移したもの。
// 料金・具体的な質問数は含めず、確定後に別設定から供給する。
export const PLAN_FEATURE_ROWS: readonly PlanFeatureRow[] = [
  { feature: "6領域スコア", light: "月次", standard: "週次", premium: "日次・週次サマリー" },
  { feature: "対象AI", light: "主要2種", standard: "5種", premium: "5種" },
  { feature: "監視プロンプト", light: "少数", standard: "標準", premium: "拡張" },
  { feature: "競合医院", light: "3院", standard: "10院", premium: "20院" },
  { feature: "AI Overviews", light: "基本", standard: "標準", premium: "拡張" },
  { feature: "AI流入・予約分析", light: "基本", standard: "標準", premium: "標準＋レビュー" },
  { feature: "ヒートマップ", light: "なし", standard: "主要ページ", premium: "全対象ページ＋詳細分析" },
  { feature: "ヒートマップAI改善提案", light: "なし", standard: "月次", premium: "週次＋専門家レビュー" },
  { feature: "フォーム離脱分析", light: "なし", standard: "基本", premium: "詳細" },
  { feature: "A/Bテスト", light: "なし", standard: "なし", premium: "順次提供" },
  { feature: "改善タスク", light: "TOP3", standard: "無制限", premium: "無制限＋専門家調整" },
  { feature: "指示書", light: "都度課金", standard: "月1件込み", premium: "月3件込み" },
  { feature: "Academy", light: "利用可能", standard: "利用可能", premium: "利用可能" },
  { feature: "初回無料相談", light: "なし", standard: "45分・1回", premium: "45分・1回" },
  { feature: "継続面談", light: "なし", standard: "単発有料", premium: "月1回込み" },
] as const;

export function isPlanId(value: string): value is PlanId {
  return PLAN_IDS.includes(value as PlanId);
}

/**
 * ダッシュボードの競合医院比較で表示する件数の上限(PLAN_FEATURE_ROWSの「競合医院」行と
 * 一致させる)。診断時に何院探索するかという診断エンジン側のロジックではなく、
 * 既に取得済みの候補のうち画面へ何院まで表示するかという表示制御のみを行う
 * (2026-09-22のユーザー指示: プラン別表示制御)。未契約(プラン不明)は最も狭いlight相当。
 */
export const COMPETITOR_DISPLAY_LIMIT: Readonly<Record<PlanId, number>> = {
  light: 3,
  standard: 10,
  premium: 20,
} as const;
