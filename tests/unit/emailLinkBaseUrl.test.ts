import { describe, expect, it } from "vitest";
import { resolveEmailLinkBaseUrl } from "@/server/config/resultEmailConfig";

describe("resolveEmailLinkBaseUrl", () => {
  it("EMAIL_LINK_BASE_URL未設定時はfallback(APP_BASE_URL)をそのまま使う", () => {
    expect(resolveEmailLinkBaseUrl({}, "https://dentshift.jp")).toBe("https://dentshift.jp");
  });

  it("EMAIL_LINK_BASE_URLがHTTPSの有効なURLなら、そちらを使う(fallbackより優先)", () => {
    const result = resolveEmailLinkBaseUrl(
      { EMAIL_LINK_BASE_URL: "https://dent-shift-test-git-release-abc-dentshift1.vercel.app" },
      "https://test.dentshift.jp"
    );
    expect(result).toBe("https://dent-shift-test-git-release-abc-dentshift1.vercel.app");
  });

  it("HTTPS以外のscheme(http等)は拒否し、fallbackへ戻る(任意のHostを信用しない)", () => {
    const result = resolveEmailLinkBaseUrl(
      { EMAIL_LINK_BASE_URL: "http://insecure.example.com" },
      "https://test.dentshift.jp"
    );
    expect(result).toBe("https://test.dentshift.jp");
  });

  it("URLとして解釈できない値はfallbackへ戻る", () => {
    const result = resolveEmailLinkBaseUrl(
      { EMAIL_LINK_BASE_URL: "not a url" },
      "https://test.dentshift.jp"
    );
    expect(result).toBe("https://test.dentshift.jp");
  });

  it("パス・クエリを含む値はoriginだけを使う(任意パスをリンク生成へ持ち込まない)", () => {
    const result = resolveEmailLinkBaseUrl(
      { EMAIL_LINK_BASE_URL: "https://preview.example.com/some/path?x=1" },
      "https://test.dentshift.jp"
    );
    expect(result).toBe("https://preview.example.com");
  });
});
