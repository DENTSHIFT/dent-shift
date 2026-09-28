import { describe, expect, it } from "vitest";
import {
  analyzeRobotsTxt,
  analyzeNoindex,
  analyzeStructuredData,
  analyzeContentClarity,
} from "@/server/providers/website-analysis/websiteAnalyzer";

/**
 * 2026-09-29追加(PO指示): LLMO実測(crawler_access/structured_data/content_clarity)の
 * 純粋関数(HTML/robots.txt本文の解析)に対するfixtureテスト。ネットワークには一切依存しない。
 */

describe("analyzeRobotsTxt", () => {
  it("robots.txtが無い/空の場合はAIクローラーを許可扱いにする", () => {
    const result = analyzeRobotsTxt("");
    expect(result.allowsAiCrawlers).toBe(true);
    expect(result.blockedUserAgents).toEqual([]);
  });

  it("User-agent: * / Disallow: / の場合、全クローラー拒否と判定する", () => {
    const result = analyzeRobotsTxt("User-agent: *\nDisallow: /\n");
    expect(result.allowsAiCrawlers).toBe(false);
    expect(result.blockedUserAgents).toContain("*");
  });

  it("GPTBotを個別に拒否している場合を検出する", () => {
    const result = analyzeRobotsTxt("User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nDisallow:\n");
    expect(result.allowsAiCrawlers).toBe(false);
    expect(result.blockedUserAgents).toContain("GPTBot");
  });

  it("特定ページのみのDisallow(全体拒否ではない)はAIクローラー許可のまま扱う", () => {
    const result = analyzeRobotsTxt("User-agent: *\nDisallow: /admin\n");
    expect(result.allowsAiCrawlers).toBe(true);
  });
});

describe("analyzeNoindex", () => {
  it("noindexが無ければfalse/falseを返す", () => {
    const result = analyzeNoindex("<html><head></head></html>", null);
    expect(result.hasNoindexMeta).toBe(false);
    expect(result.hasNoindexHeader).toBe(false);
  });

  it("<meta name=\"robots\" content=\"noindex\">を検出する", () => {
    const result = analyzeNoindex('<meta name="robots" content="noindex,nofollow">', null);
    expect(result.hasNoindexMeta).toBe(true);
  });

  it("X-Robots-Tagヘッダのnoindexを検出する", () => {
    const result = analyzeNoindex("<html></html>", "noindex");
    expect(result.hasNoindexHeader).toBe(true);
  });
});

describe("analyzeStructuredData", () => {
  it("JSON-LDが無ければfound=falseを返す", () => {
    const result = analyzeStructuredData("<html><body>本文</body></html>");
    expect(result.found).toBe(false);
    expect(result.types).toEqual([]);
  });

  it("Dentist型のJSON-LDを検出する", () => {
    const html = `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Dentist","name":"サンプル歯科"}</script>`;
    const result = analyzeStructuredData(html);
    expect(result.found).toBe(true);
    expect(result.types).toContain("Dentist");
    expect(result.hasMedicalRelevantType).toBe(true);
  });

  it("医療機関と無関係な型(例: WebSite)のみの場合はhasMedicalRelevantType=falseにする", () => {
    const html = `<script type="application/ld+json">{"@type":"WebSite","name":"x"}</script>`;
    const result = analyzeStructuredData(html);
    expect(result.found).toBe(true);
    expect(result.hasMedicalRelevantType).toBe(false);
  });

  it("不正なJSON(壊れたJSON-LD)はエラーにせず無視する", () => {
    const html = `<script type="application/ld+json">{not valid json</script>`;
    expect(() => analyzeStructuredData(html)).not.toThrow();
    expect(analyzeStructuredData(html).found).toBe(false);
  });

  it("@graph配下の複数ノードを検出する", () => {
    const html = `<script type="application/ld+json">{"@graph":[{"@type":"LocalBusiness","name":"a"},{"@type":"WebPage"}]}</script>`;
    const result = analyzeStructuredData(html);
    expect(result.types).toContain("LocalBusiness");
    expect(result.hasMedicalRelevantType).toBe(true);
  });
});

describe("analyzeContentClarity", () => {
  it("見出しも本文もない場合はhasReadableContent=falseを返す", () => {
    const result = analyzeContentClarity("<html><body></body></html>");
    expect(result.hasReadableContent).toBe(false);
    expect(result.hasH1).toBe(false);
  });

  it("見出しと十分な本文がある場合はhasReadableContent=trueを返す", () => {
    const longText = "あ".repeat(250);
    const html = `<html><body><h1>見出し</h1><p>${longText}</p></body></html>`;
    const result = analyzeContentClarity(html);
    expect(result.hasH1).toBe(true);
    expect(result.hasReadableContent).toBe(true);
  });

  it("scriptタグの中身は本文としてカウントしない", () => {
    const html = `<html><body><h1>見出し</h1><script>${"x".repeat(500)}</script></body></html>`;
    const result = analyzeContentClarity(html);
    expect(result.hasReadableContent).toBe(false);
  });
});
