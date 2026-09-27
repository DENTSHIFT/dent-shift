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

// 2026-09-27修正(PO承認、P0-1/P0-2): プランごとに実際には差がない機能を「差があるかの
// ように」表示していた項目(対象AI数・監視プロンプト・競合医院数・AI Overviews・
// AI流入分析・ヒートマップ・フォーム離脱分析・A/Bテスト・Academy・相談回数等)を削除した。
// これらは現時点でコード上プランによる分岐が存在しない、または機能自体が未実装のため。
// 実装済みで、かつプラン間に実際の差がある項目は「改善指示書PDFの無料枠」のみ。
export const PLAN_SUMMARIES: readonly PlanSummary[] = [
  {
    id: "light",
    name: "ライトプラン",
    description: "まずは無料AI集患診断から始めたい医院向け",
    recommended: false,
    highlights: ["無料AI集患診断", "患者質問ごとのAI表示状況の確認", "改善指示書PDF：都度課金"],
  },
  {
    id: "standard",
    name: "スタンダードプラン",
    description: "改善指示書PDFを毎月使いたい医院向け",
    recommended: true,
    highlights: ["無料AI集患診断", "患者質問ごとのAI表示状況の確認", "改善指示書PDF：月1件込み"],
  },
  {
    id: "premium",
    name: "プレミアムプラン",
    description: "改善指示書PDFを複数回利用したい医院向け(トライアル対象外・即時課金)",
    recommended: false,
    highlights: ["無料AI集患診断", "患者質問ごとのAI表示状況の確認", "改善指示書PDF：月3件込み"],
  },
] as const;

// 2026-09-27修正(PO承認、P0-2): 現時点で実装済み・実データで提供を確認できる項目だけを
// 掲載する。プラン間に実際の差がある項目は「改善指示書PDFの無料枠」のみで、他は
// 全プラン共通のため、無理に差があるかのような表は作らない。
export const PLAN_FEATURE_ROWS: readonly PlanFeatureRow[] = [
  { feature: "無料AI集患診断", light: "利用可能", standard: "利用可能", premium: "利用可能" },
  {
    feature: "患者質問ごとのAI表示状況の確認",
    light: "利用可能",
    standard: "利用可能",
    premium: "利用可能",
  },
  { feature: "改善指示書PDFの無料枠", light: "都度課金", standard: "月1件込み", premium: "月3件込み" },
  {
    feature: "専門家への相談予約",
    light: "予約導線あり(全プラン共通)",
    standard: "予約導線あり(全プラン共通)",
    premium: "予約導線あり(全プラン共通)",
  },
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
