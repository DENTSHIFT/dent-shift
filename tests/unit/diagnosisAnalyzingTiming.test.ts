import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 2026-09-29追加(PO指示): 診断API完了(実測13.5秒)後もさらに数秒待たされる体感遅延の
 * 回帰テスト。原因は解析演出が固定12秒(ANALYZING_DURATION_MS)になっており、
 * APIが12秒を超えるとさらにAPI完了を待つ設計自体は正しかったが、「最低表示時間」が
 * 12秒と長すぎたため、APIが速く終わるケースでも常に12秒待たされていた。
 * 最低表示時間を2〜3秒へ短縮し、以後はAPI完了(apiCompleted)を待つだけにする。
 */
describe("診断解析演出のタイミング(固定12秒待機の廃止)", () => {
  function diagnosisPageSource(): string {
    return readFileSync(path.join(process.cwd(), "src/app/diagnosis/page.tsx"), "utf8");
  }

  it("最低表示時間は2〜3秒(MIN_DISPLAY_MS)であり、旧来の固定12秒(ANALYZING_DURATION_MS)は使われていない", () => {
    const source = diagnosisPageSource();
    expect(source).not.toContain("ANALYZING_DURATION_MS");
    const match = source.match(/const MIN_DISPLAY_MS = (\d+);/);
    expect(match).not.toBeNull();
    const minDisplayMs = Number(match![1]);
    expect(minDisplayMs).toBeGreaterThanOrEqual(2000);
    expect(minDisplayMs).toBeLessThanOrEqual(3000);
  });

  it("API完了(apiCompletedRef)を最低表示時間経過後すぐに反映し、演出の完了を待たせない分岐を持つ", () => {
    const source = diagnosisPageSource();
    expect(source).toContain("apiCompletedRef");
    // 最低表示時間経過 かつ API完了済みなら、演出を締めくくる分岐が存在すること。
    expect(source).toMatch(/minDisplayElapsed\s*&&\s*apiCompletedRef\.current/);
  });

  it("90%以降、APIがまだ完了していない間も進捗が止まって見えないよう、ゆっくり進み続ける分岐を持つ(99%上限)", () => {
    const source = diagnosisPageSource();
    expect(source).toContain("STALL_DISPLAY_PERCENT");
    expect(source).toMatch(/Math\.min\(99,\s*STALL_DISPLAY_PERCENT/);
  });

  it("診断処理が長時間終わらない場合にタイムアウトし、エラー状態(再試行導線)へ切り替えるガードを持つ", () => {
    const source = diagnosisPageSource();
    expect(source).toContain("ANALYSIS_TIMEOUT_MS");
    expect(source).toContain("window.setTimeout(");
    expect(source).toMatch(/setFlowState\("error"\)/);
    // タイムアウト時は世代番号を進め、後から遅れて届く結果(古いfetch)を無視すること。
    expect(source).toMatch(/requestGenerationRef\.current \+= 1;[\s\S]{0,400}setFlowState\("error"\)/);
  });

  it("startAnalysis/handleRetryの両方でapiCompletedRefをfalseへリセットする(次回診断への状態持ち越し防止)", () => {
    const source = diagnosisPageSource();
    const resetCount = (source.match(/apiCompletedRef\.current = false;/g) ?? []).length;
    expect(resetCount).toBeGreaterThanOrEqual(2);
  });
});

describe("AnalyzingScreenの案内文言(90%以降で表示)", () => {
  function analyzingScreenSource(): string {
    return readFileSync(path.join(process.cwd(), "src/app/diagnosis/AnalyzingScreen.tsx"), "utf8");
  }

  it("案内文言は100%到達後ではなく90%以降(PO指定の90〜95%帯)で表示される", () => {
    const source = analyzingScreenSource();
    expect(source).toContain('roundedPercent >= 90');
    expect(source).not.toMatch(/apiStatus === "pending" && roundedPercent >= 100/);
    expect(source).toContain("分析結果をまとめています。もう少しお待ちください。");
  });
});
