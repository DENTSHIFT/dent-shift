import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("無料診断入口の中立的な表現", () => {
  it("勝ち・負けではなく、AI表示状況と改善余地で案内する", () => {
    const source = readFileSync(path.join(process.cwd(), "src/app/diagnosis/page.tsx"), "utf8");

    expect(source).toContain(
      "実際に取得できた範囲で、AI上の表示状況と医院情報の設定状況を確認します。"
    );
    expect(source).toContain('description="患者質問ごとにAIで表示されたか"');
    expect(source).not.toContain("患者質問ごとの勝ち負け");
    expect(source).not.toContain("競合にどこで負けているかを約60秒で診断します。");
    // 2026-09-27追加(PO承認): 名前つき競合比較が利用できるかのような断定表現を残さない。
    expect(source).not.toContain('title="競合との差"');
  });

  it("電話番号を必須項目として案内する", () => {
    const source = readFileSync(path.join(process.cwd(), "src/app/diagnosis/page.tsx"), "utf8");

    expect(source).toContain('label="電話番号(携帯番号)"');
    expect(source).toContain('type="tel"');
    expect(source).toContain("営業電話は一切行いません");
    expect(source).not.toContain("電話番号不要");
    expect(source).not.toContain('required={false}\n                  type="tel"');
  });

  it("相談導線の見出しは所要時間を付けずに統一する", () => {
    const source = readFileSync(path.join(process.cwd(), "src/app/diagnosis/page.tsx"), "utf8");

    expect(source).toContain("スペシャリストに相談する");
    expect(source).not.toContain("スペシャリストに相談する(45分)");
  });
});
