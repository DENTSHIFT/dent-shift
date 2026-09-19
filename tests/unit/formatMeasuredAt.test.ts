import { describe, expect, it } from "vitest";
import { formatMeasuredAtInJapan } from "@/domain/diagnosis/formatMeasuredAt";

describe("計測日時の日本時間表示", () => {
  it("UTC時刻をAsia/Tokyoへ変換する", () => {
    const label = formatMeasuredAtInJapan("2026-09-10T04:14:12.000Z");
    expect(label).toContain("2026/9/10");
    expect(label).toContain("13:14:12");
  });
});
