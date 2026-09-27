import { describe, expect, it } from "vitest";
import {
  COMPETITOR_DISPLAY_LIMIT,
  isPlanId,
  PLAN_FEATURE_ROWS,
  PLAN_SUMMARIES,
  type PlanFeatureCell,
} from "@/domain/billing/planCatalog";

function cellEquals(a: PlanFeatureCell, b: PlanFeatureCell): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

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

  // 2026-09-27修正(PO承認、P0-1/P0-2)、2026-09-28拡張(P1-4): プラン間に実際の差がない
  // 機能(対象AI数・監視プロンプト・競合医院数・AI Overviews・ヒートマップ等)を比較表から
  // 削除・再混入させない。実際にプラン間で差がある項目は「改善指示書PDFの無料枠」のみ
  // であることを保証する。
  it("実装済みで、かつプラン間に実際の差がある項目だけを掲載する(未実装機能名の再混入を防ぐ回帰テスト)", () => {
    const rowNames = PLAN_FEATURE_ROWS.map((row) => row.feature);
    const bannedFeatureNames = [
      "対象AI",
      "監視プロンプト",
      "競合医院",
      "AI Overviews",
      "AI流入・予約分析",
      "ヒートマップ",
      "ヒートマップAI改善提案",
      "フォーム離脱分析",
      "Academy",
      "他院との比較",
      "地域平均との比較",
      "競合分析",
    ];
    for (const banned of bannedFeatureNames) {
      expect(rowNames).not.toContain(banned);
    }

    const rowsWithActualDifference = PLAN_FEATURE_ROWS.filter(
      (row) => !(cellEquals(row.light, row.standard) && cellEquals(row.standard, row.premium))
    );
    expect(rowsWithActualDifference.map((row) => row.feature)).toEqual(["改善指示書PDFの無料枠"]);
  });

  it("2026-09-28追加(P1-4): categoryが正しく分類されている(common行はセルが全プラン同一、differs行は異なる)", () => {
    for (const row of PLAN_FEATURE_ROWS) {
      const allSame = cellEquals(row.light, row.standard) && cellEquals(row.standard, row.premium);
      if (row.category === "common") {
        expect(allSame).toBe(true);
      }
      if (row.category === "differs") {
        expect(allSame).toBe(false);
      }
    }
  });

  it("2026-09-28追加(P1-4): Mock・未実装機能・将来構想を「利用可能」にしない(comingSoonのセルはavailableではない)", () => {
    for (const row of PLAN_FEATURE_ROWS) {
      if (row.category === "comingSoon") {
        expect(row.light.kind).not.toBe("available");
        expect(row.standard.kind).not.toBe("available");
        expect(row.premium.kind).not.toBe("available");
      }
    }
  });

  it("COMPETITOR_DISPLAY_LIMITは内部の表示上限値であり、ユーザー向け機能一覧の項目としては掲載しない", () => {
    // 近隣競合の実データ取得は未実装(常に0件)のため、この上限値自体は現状表示に影響しない。
    expect(COMPETITOR_DISPLAY_LIMIT).toEqual({ light: 3, standard: 10, premium: 20 });
    expect(PLAN_FEATURE_ROWS.map((row) => row.feature)).not.toContain("競合医院");
  });
});
