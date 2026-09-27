import { describe, expect, it } from "vitest";
import { buildHttpsAdvisory } from "@/domain/clinic/httpsAdvisory";

describe("buildHttpsAdvisory", () => {
  it("http:// のときだけ案内を返し、https:// や未設定では返さない(=変更後は自動で非表示)", () => {
    expect(buildHttpsAdvisory("http://example.com")?.title).toBe("WebサイトをHTTPSに対応しましょう");
    expect(buildHttpsAdvisory("https://example.com")).toBeNull();
    expect(buildHttpsAdvisory("")).toBeNull();
    expect(buildHttpsAdvisory(null)).toBeNull();
  });
  it("指定の説明文を使い、断定・ダウンロード表現を含めない", () => {
    const advisory = buildHttpsAdvisory("http://example.com")!;
    expect(advisory.description).toContain("HTTPSに対応していない可能性があります");
    expect(advisory.description).toContain("SSL証明書の設定についてご相談ください");
    expect(advisory.description).not.toContain("ダウンロード");
    expect(advisory.description).not.toContain("設定されていません");
  });
  it("案内から外部へ送信せず、設定画面へのリンクだけを持つ", () => {
    expect(buildHttpsAdvisory("http://example.com")?.actionHref).toBe("/dashboard/settings");
  });
});
