import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { UnavailableCompetitorProvider } from "@/server/providers/competitor/unavailableCompetitorProvider";
import { UnavailableAdComplianceProvider } from "@/server/providers/ad-compliance/unavailableAdComplianceProvider";
import type { CompetitorProvider } from "@/server/providers/competitor/types";
import type { AdComplianceProvider } from "@/server/providers/ad-compliance/types";

/**
 * 2026-09-24: 近隣競合比較・医療広告AIチェックは実データ取得基盤が未実装のため、
 * 架空の競合医院名やダミーのリスク判定を本番で絶対に出さないことを保証する回帰テスト。
 * MockCompetitorProvider/MockAdComplianceProviderが生成していた「[サンプル]近隣〇〇歯科」
 * 等のダミーデータが、本番経路(src/app/api/diagnosis/route.ts)で二度と使われないことの
 * 最終防衛線。
 */
describe("UnavailableCompetitorProvider", () => {
  it("常に空配列を返す(医院名・URLを渡しても架空の競合を生成しない)", async () => {
    const provider: CompetitorProvider = new UnavailableCompetitorProvider();
    const result = await provider.findNearbyCompetitors("テスト歯科", "https://example.com");
    expect(result).toEqual([]);
  });
});

describe("UnavailableAdComplianceProvider", () => {
  it("常に空配列を返す(ダミーのリスク判定を生成しない)", async () => {
    const provider: AdComplianceProvider = new UnavailableAdComplianceProvider();
    const result = await provider.check({
      clinicName: "テスト歯科",
      clinicUrl: "https://example.com",
    });
    expect(result).toEqual([]);
  });
});

describe("本番診断API(route.ts)がMockCompetitorProvider/MockAdComplianceProviderを使わないこと", () => {
  it("src/app/api/diagnosis/route.tsがUnavailable系providerをインスタンス化している", () => {
    const content = readFileSync(
      resolve(process.cwd(), "src/app/api/diagnosis/route.ts"),
      "utf-8"
    );
    expect(content).toContain("new UnavailableCompetitorProvider()");
    expect(content).toContain("new UnavailableAdComplianceProvider()");
    // 架空の競合医院名・ダミーリスク判定を生成するMock系providerが
    // 本番経路へ再混入していないことを静的に保証する。
    expect(content).not.toMatch(/new MockCompetitorProvider\(/);
    expect(content).not.toMatch(/new MockAdComplianceProvider\(/);
  });
});
