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

/**
 * 2026-09-29追加(PO指示): 45秒タイムアウト後の「もう一度診断する」が、サーバー側で
 * 継続中の処理(Clinic作成はsaveDiagnosisResult内、AI分析完了後まで行われない)と
 * 競合し、同一医院を二重作成しうる問題の回帰テスト。
 *
 * 重複防止が保証できないことを確認した根拠:
 * - findClinicDuplicateCandidate()はDBの一意制約に依らないfindMany+アプリ層判定のみ
 *   (src/server/db/clinicDuplicateRepository.ts)
 * - prisma/schema.prismaのClinicモデルにname/urlの@@unique制約は無い
 * - saveDiagnosisResult()内のprisma.clinic.create()は、AI分析(10〜30秒超)完了後まで
 *   呼ばれない(src/server/db/diagnosisRepository.ts)ため、タイムアウト直後に
 *   同一内容で再送すると、元のリクエストがまだClinicを作成していない状態で
 *   重複チェックをすり抜け、2件目のClinic/Diagnosisが作成されうる。
 *
 * そのため、タイムアウト由来のエラーだけは「もう一度診断する」を出さず、
 * 安全な導線(ログイン中はダッシュボード、未ログインはトップページ)へ差し替える。
 */
describe("タイムアウト時は再試行ボタンを出さず、安全な導線へ差し替える(重複作成防止)", () => {
  function pageSource(): string {
    return readFileSync(path.join(process.cwd(), "src/app/diagnosis/page.tsx"), "utf8");
  }

  function analyzingScreenSource(): string {
    return readFileSync(path.join(process.cwd(), "src/app/diagnosis/AnalyzingScreen.tsx"), "utf8");
  }

  it("page.tsx: タイムアウト時にisTimeoutErrorをtrueにし、AnalyzingScreenへ渡す", () => {
    const source = pageSource();
    expect(source).toMatch(/setIsTimeoutError\(true\);[\s\S]{0,80}setFlowState\("error"\)/);
    expect(source).toContain("isTimeoutError={isTimeoutError}");
    expect(source).toContain("isAuthenticated={authenticatedProfile !== null}");
  });

  it("page.tsx: 新しい診断開始(startAnalysis)・リトライ(handleRetry)の両方でisTimeoutErrorをfalseへリセットする", () => {
    const source = pageSource();
    const resetCount = (source.match(/setIsTimeoutError\(false\);/g) ?? []).length;
    expect(resetCount).toBeGreaterThanOrEqual(2);
  });

  it("AnalyzingScreen.tsx: isTimeoutErrorがtrueの場合は「もう一度診断する」ボタンを出さない", () => {
    const source = analyzingScreenSource();
    expect(source).toMatch(/isTimeoutError \? \(/);
    // 通常(非タイムアウト)エラーの再試行ボタンは維持されていること。
    expect(source).toContain("もう一度診断する");
  });

  it("AnalyzingScreen.tsx: タイムアウト時、ログイン中は「診断履歴を確認する」、未ログインは「トップページへ戻る」を表示する", () => {
    const source = analyzingScreenSource();
    expect(source).toContain('isAuthenticated ? "/dashboard" : "/"');
    expect(source).toContain('isAuthenticated ? "診断履歴を確認する" : "トップページへ戻る"');
  });
});

/**
 * 2026-09-29追加(PO指示の実測検証中に判明): requestAnimationFrameがタブの描画状態に
 * 依存して長時間発火しないことがあり、進捗表示・遷移判定の信頼性に影響しうるため、
 * setIntervalベースへ変更した回帰テスト。
 */
describe("進捗更新はrequestAnimationFrameではなくsetIntervalを使う", () => {
  function pageSource(): string {
    return readFileSync(path.join(process.cwd(), "src/app/diagnosis/page.tsx"), "utf8");
  }

  it("requestAnimationFrame/cancelAnimationFrameは使われていない", () => {
    const source = pageSource();
    expect(source).not.toContain("requestAnimationFrame(");
    expect(source).not.toContain("cancelAnimationFrame(");
  });

  it("setInterval(tick, 100)で100ms間隔の更新を行う", () => {
    const source = pageSource();
    expect(source).toContain("setInterval(tick, 100)");
    expect(source).toContain("tickIntervalRef");
  });
});
