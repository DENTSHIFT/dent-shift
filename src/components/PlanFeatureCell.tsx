import type { PlanFeatureCell } from "@/domain/billing/planCatalog";

/**
 * 2026-09-28追加(PO承認、P1-4): プラン別機能一覧の各セルを、画像に焼き込まず
 * HTML/CSSで視覚化する共有コンポーネント(LPの比較表・/plansページの比較表の
 * 両方から使う、表示ロジックの重複を避ける)。
 * - 利用可能: 緑のチェック
 * - 利用不可: 薄いグレーの「—」
 * - 数量差: 実際の値をそのまま表示
 * - 準備中: 「準備中」
 * スクリーンリーダー向けに、アイコンだけでなく`aria-label`でテキスト情報も持たせる。
 */
export function PlanFeatureCellView({ cell }: { cell: PlanFeatureCell }) {
  switch (cell.kind) {
    case "available":
      return (
        <span aria-label="利用可能">
          <span aria-hidden="true" style={{ color: "#16a34a", fontWeight: 900, fontSize: 16 }}>
            ○
          </span>
        </span>
      );
    case "unavailable":
      return (
        <span aria-label="利用不可">
          <span aria-hidden="true" style={{ color: "#cbd5e1", fontWeight: 700 }}>
            —
          </span>
        </span>
      );
    case "quantity":
      return <span>{cell.label}</span>;
    case "comingSoon":
      return (
        <span aria-label="準備中" style={{ color: "#94a3b8", fontSize: 12 }}>
          準備中
        </span>
      );
  }
}
