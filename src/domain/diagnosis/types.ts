// 6領域100点診断のドメイン型
// フレームワーク・DBに依存しない純粋な型定義(ARCHITECTURE.md 4章「Domain層」に対応)
// サブ項目の配点定義そのものは scoreCriteria.ts を参照(このファイルは型のみ)。

export type DomainKey = "AIO" | "MEO" | "SEO" | "LLMO" | "WEB_BOOKING" | "REVIEWS";

// criterion(サブ項目)単位のステータス。
// "measured": 実際のデータ連携から取得した値(P0時点では未実装。将来のlive providerのみが返せる)
// "estimated": 何らかの根拠に基づく推定値(mock providerも含む。実測ではない)
// "unavailable": 必要な情報が未入力/未接続で測定できない(0点として合算しない)
export type CriterionStatus = "measured" | "estimated" | "unavailable";

/**
 * status が "unavailable"(または各所の"insufficient_data")になった理由を機械可読に保持する型
 * (2026-09-06のユーザー指示④: 診断データの意味を失わず保持するdomain/persistence仕様。
 * 画面刷新フェーズでUI表示用の院長向け日本語ラベルへ変換する。ここではmachine-readableな
 * 値の保持のみを扱い、UI表示ロジックは持たない)。
 * - "not_provided": 必要な入力値自体が提供されていない
 * - "not_connected": 必要な外部連携が設定されていない
 * - "permission_required": 接続は存在するが権限不足・再認証等が必要
 * - "insufficient_data": 接続・取得自体はできても評価に必要なデータ量が不足
 * - "temporarily_unavailable": 一時障害、rate limit、timeout等で現在取得不能
 * - "fetch_failed": fetch/parse/provider処理を試みたが取得に失敗
 * - "not_applicable": その診断条件では対象外(不明時のfallbackとして使わない)
 *
 * mock providerが実測不能を表現する場合もこの型で理由を明示する。ただしmock由来の値を
 * 実測エラーや実測0点として扱ってはならない(mockはmockであることをdataSource/sourceTypeで
 * 別途申告する。unavailableReasonはあくまで「なぜ値が無いか」のみを表す)。
 */
export type UnavailableReason =
  | "not_provided"
  | "not_connected"
  | "permission_required"
  | "insufficient_data"
  | "temporarily_unavailable"
  | "fetch_failed"
  | "not_applicable";

// データの出所。P0はmockのみを使うが、将来のreal provider追加を見越して型を拡張しておく。
export type DataSource =
  | "mock"
  | "website"
  | "google_business_profile"
  | "search_console"
  | "ga4"
  | "ai_provider"
  | "manual";

// 「なぜこの点数なのか」を後からUI・監査ログで説明できるようにするための構造化evidence。
// P0実装では summary 以外は任意項目のままでよい(すべて埋める必要はない)。
export interface CriterionEvidence {
  summary: string;
  ruleKey?: string;
  sourceUrl?: string;
  observedValue?: string | number | boolean;
}

export interface CriterionScore {
  key: string;
  label: string;
  maxScore: number;
  // unavailableのときは必ずnull(0点として扱わない)
  score: number | null;
  status: CriterionStatus;
  evidence: CriterionEvidence[];
  // 取得していないデータに測定日時が存在するように見せないため、unavailable時はnull
  measuredAt: string | null;
  dataSource: DataSource;
  /**
   * status === "unavailable" のときのみ必須(non-null)。measured/estimatedのときは必ずnull
   * (2026-09-06のユーザー指示④ 基本ルール1・4)。calculateDomainScore()(scoring.ts)がこの
   * 対応関係を実行時に検証する。
   */
  unavailableReason: UnavailableReason | null;
}

// domain(領域)単位の集計ステータス。criteriaの状態から導出する。
// "unavailable": その領域の全criterionが取得不能
// "partial": 一部のcriterionのみ取得不能(取得できた分だけで単純に100%換算しない)
// "estimated": 全criterionは取得できたが、実測(measured)は1件もない
// "measured": 全criterionが実測値
export type DomainAggregateStatus = "measured" | "estimated" | "partial" | "unavailable";

export interface DomainScore {
  domain: DomainKey;
  // その領域の満点(正本の配点合計。常に固定値で、測定状況によって変動しない)
  maxPoints: number;
  // 実際に測定・推定できたcriterionの配点合計(unavailableな項目のmaxScoreは含めない)
  assessedMaxPoints: number;
  // assessed分のscore合計(取得不能な項目を0点として加算していない)
  points: number;
  // assessedMaxPoints / maxPoints (0〜1)。「15点分しか測定できていない」を表現する
  coverage: number;
  status: DomainAggregateStatus;
  criteria: CriterionScore[];
}

export type OverallScoreStatus = DomainAggregateStatus;

export interface DiagnosisScoreBreakdown {
  domains: DomainScore[];
  maxPoints: number; // 常に100(6領域の配点合計)
  assessedMaxPoints: number;
  totalPoints: number;
  coverage: number;
  totalStatus: OverallScoreStatus;
}
