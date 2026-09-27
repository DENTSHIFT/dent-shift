import { describe, expect, it } from "vitest";
import {
  COMPETITOR_DISPLAY_LIMIT,
  isPlanId,
  PLAN_FEATURE_ROWS,
  PLAN_SUMMARIES,
} from "@/domain/billing/planCatalog";

describe("プラン比較カタログ", () => {
  it("3プランを重複なく定義する", () => {
    expect(PLAN_SUMMARIES.map((plan) => plan.id)).toEqual(["light", "standard", "premium"]);
    expect(PLAN_SUMMARIES.filter((plan) => plan.recommended)).toHaveLength(1);
  });

  it("料金をカタログへハードコードしない", () => {
    expect(JSON.stringify(PLAN_SUMMARIES)).not.toMatch(/[¥￥]\s*\d|月額\s*\d/);
  });

  it("許可されたプランIDだけを受け付ける", () => {
    expect(isPlanId("standard")).toBe(true);
    expect(isPlanId("enterprise")).toBe(false);
  });

  // 2026-09-27修正(PO承認、P0-1/P0-2): プラン間に実際の差がない機能(対象AI数・
  // 監視プロンプト・競合医院数・AI Overviews・ヒートマップ等)を比較表から削除した。
  // 実際にプラン間で差がある項目は「改善指示書PDFの無料枠」のみであることを保証する。
  it("実装済みで、かつプラン間に実際の差がある項目だけを掲載する", () => {
    const rowNames = PLAN_FEATURE_ROWS.map((row) => row.feature);
    expect(rowNames).not.toContain("対象AI");
    expect(rowNames).not.toContain("監視プロンプト");
    expect(rowNames).not.toContain("競合医院");
    expect(rowNames).not.toContain("AI Overviews");
    expect(rowNames).not.toContain("AI流入・予約分析");
    expect(rowNames).not.toContain("ヒートマップ");
    expect(rowNames).not.toContain("ヒートマップAI改善提案");
    expect(rowNames).not.toContain("フォーム離脱分析");
    expect(rowNames).not.toContain("Academy");

    const rowsWithActualDifference = PLAN_FEATURE_ROWS.filter(
      (row) => !(row.light === row.standard && row.standard === row.premium)
    );
    expect(rowsWithActualDifference.map((row) => row.feature)).toEqual(["改善指示書PDFの無料枠"]);
  });

  it("COMPETITOR_DISPLAY_LIMITは内部の表示上限値であり、ユーザー向け機能一覧の項目としては掲載しない", () => {
    // 近隣競合の実データ取得は未実装(常に0件)のため、この上限値自体は現状表示に影響しない。
    expect(COMPETITOR_DISPLAY_LIMIT).toEqual({ light: 3, standard: 10, premium: 20 });
    expect(PLAN_FEATURE_ROWS.map((row) => row.feature)).not.toContain("競合医院");
  });
});
