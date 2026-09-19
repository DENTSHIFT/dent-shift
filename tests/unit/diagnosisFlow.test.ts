import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { shouldNavigateToResult, type DiagnosisFlowSnapshot } from "@/app/diagnosis/diagnosisFlow";

/**
 * src/app/diagnosis/page.tsx で「解析中画面がほぼ表示されず結果画面へ即時遷移する」バグが
 * 実Macで報告されたことへの対応(2026-09-06のユーザー指示)。
 *
 * 「最低表示時間完了(analysisCompleted)」AND「API成功+診断ID取得(apiCompleted+
 * diagnosisId)」の両方が揃うまでは絶対に遷移しないことを、Reactに依存しない純粋関数
 * shouldNavigateToResult()の単体テストとして固定する。このリポジトリのvitest設定
 * (vitest.config.ts)はenvironment: "node"でjsdom/testing-libraryを使わない方針
 * (tests/unit配下の既存テストはすべてdomain/serverの純粋ロジックのみを対象にしている)
 * ため、React実コンポーネントのタイマー駆動テストではなく、遷移可否の判定ロジックを
 * 独立した純粋関数として抽出したうえでテストする形を取っている。
 */

const base: DiagnosisFlowSnapshot = {
  flowState: "analyzing",
  analysisCompleted: false,
  apiCompleted: false,
  diagnosisId: null,
};

describe("shouldNavigateToResult", () => {
  it("1. APIが即成功しても、最低表示時間(analysisCompleted)が経過していなければ遷移しない", () => {
    const snapshot: DiagnosisFlowSnapshot = {
      ...base,
      analysisCompleted: false, // 12秒未満
      apiCompleted: true,
      diagnosisId: "diag_1",
    };
    expect(shouldNavigateToResult(snapshot)).toBe(false);
  });

  it("2. 最低表示時間の経過(analysisCompleted) と API成功(apiCompleted+diagnosisId)が揃えば遷移する", () => {
    const snapshot: DiagnosisFlowSnapshot = {
      ...base,
      analysisCompleted: true,
      apiCompleted: true,
      diagnosisId: "diag_1",
    };
    expect(shouldNavigateToResult(snapshot)).toBe(true);
  });

  it("3. 最低表示時間は経過していても、APIが未完了(apiCompleted=false)なら遷移しない", () => {
    const snapshot: DiagnosisFlowSnapshot = {
      ...base,
      analysisCompleted: true,
      apiCompleted: false,
      diagnosisId: null,
    };
    expect(shouldNavigateToResult(snapshot)).toBe(false);
  });

  it("4. APIが失敗してflowStateが'error'になった場合、他の条件が揃っていても遷移しない", () => {
    const snapshot: DiagnosisFlowSnapshot = {
      flowState: "error",
      analysisCompleted: true,
      apiCompleted: false,
      diagnosisId: null,
    };
    expect(shouldNavigateToResult(snapshot)).toBe(false);
  });

  it("4b. diagnosisIdがnullのままでは、apiCompleted=trueであっても遷移しない(データ不整合の防御)", () => {
    const snapshot: DiagnosisFlowSnapshot = {
      ...base,
      analysisCompleted: true,
      apiCompleted: true,
      diagnosisId: null,
    };
    expect(shouldNavigateToResult(snapshot)).toBe(false);
  });

  it("5. src/app/diagnosis/page.tsx内でrouter.push(の呼び出しが1箇所のみであること(遷移経路の一本化)", () => {
    const testDir = path.dirname(new URL(import.meta.url).pathname);
    const pageSource = readFileSync(
      path.resolve(testDir, "../../src/app/diagnosis/page.tsx"),
      "utf-8"
    );
    const occurrences = pageSource.match(/router\.push\(/g) ?? [];
    expect(occurrences.length).toBe(1);

    // 「API成功直後に直接router.pushしてはいけない」の静的な裏付けとして、
    // window.location / redirect(...) / router.replace( のような別経路の遷移も
    // このファイルには存在しないことを確認する。
    expect(pageSource).not.toMatch(/window\.location/);
    expect(pageSource).not.toMatch(/router\.replace\(/);
    expect(pageSource).not.toMatch(/\bredirect\(/);
  });
});
