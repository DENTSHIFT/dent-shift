import { describe, expect, it } from "vitest";
import { resolveEmailLinkBaseUrl } from "@/server/config/resultEmailConfig";

describe("resolveEmailLinkBaseUrl", () => {
  it("EMAIL_LINK_BASE_URL未設定時はfallback(APP_BASE_URL)をそのまま使う", () => {
    expect(resolveEmailLinkBaseUrl({}, "https://dentshift.jp")).toBe("https://dentshift.jp");
  });

  it("EMAIL_LINK_BASE_URLがHTTPSかつ許可リスト(EMAIL_LINK_ALLOWED_HOSTS)に含まれるホストなら、そちらを使う(fallbackより優先)", () => {
    const result = resolveEmailLinkBaseUrl(
      {
        EMAIL_LINK_BASE_URL: "https://dent-shift-test-git-release-abc-dentshift1.vercel.app",
        EMAIL_LINK_ALLOWED_HOSTS: "dent-shift-test-git-release-abc-dentshift1.vercel.app",
      },
      "https://test.dentshift.jp"
    );
    expect(result).toBe("https://dent-shift-test-git-release-abc-dentshift1.vercel.app");
  });

  it("HTTPS以外のscheme(http等)は拒否し、fallbackへ戻る(任意のHostを信用しない)", () => {
    const result = resolveEmailLinkBaseUrl(
      {
        EMAIL_LINK_BASE_URL: "http://insecure.example.com",
        EMAIL_LINK_ALLOWED_HOSTS: "insecure.example.com",
      },
      "https://test.dentshift.jp"
    );
    expect(result).toBe("https://test.dentshift.jp");
  });

  it("URLとして解釈できない値はfallbackへ戻る", () => {
    const result = resolveEmailLinkBaseUrl(
      { EMAIL_LINK_BASE_URL: "not a url", EMAIL_LINK_ALLOWED_HOSTS: "test.dentshift.jp" },
      "https://test.dentshift.jp"
    );
    expect(result).toBe("https://test.dentshift.jp");
  });

  it("パス・クエリを含む値はoriginだけを使う(任意パスをリンク生成へ持ち込まない)", () => {
    const result = resolveEmailLinkBaseUrl(
      {
        EMAIL_LINK_BASE_URL: "https://preview.example.com/some/path?x=1",
        EMAIL_LINK_ALLOWED_HOSTS: "preview.example.com",
      },
      "https://test.dentshift.jp"
    );
    expect(result).toBe("https://preview.example.com");
  });

  it("EMAIL_LINK_ALLOWED_HOSTSが未設定の場合は、HTTPSの有効なURLでもfallbackへ戻る(HTTPSだけでは許可リストにならない)", () => {
    const result = resolveEmailLinkBaseUrl(
      { EMAIL_LINK_BASE_URL: "https://dent-shift-test-git-release-abc-dentshift1.vercel.app" },
      "https://test.dentshift.jp"
    );
    expect(result).toBe("https://test.dentshift.jp");
  });

  it("EMAIL_LINK_ALLOWED_HOSTSに含まれないホストはfallbackへ戻る(なりすましホストを拒否)", () => {
    const result = resolveEmailLinkBaseUrl(
      {
        EMAIL_LINK_BASE_URL: "https://evil.example.com",
        EMAIL_LINK_ALLOWED_HOSTS: "dent-shift-test-git-release-abc-dentshift1.vercel.app",
      },
      "https://test.dentshift.jp"
    );
    expect(result).toBe("https://test.dentshift.jp");
  });

  it("EMAIL_LINK_ALLOWED_HOSTSは複数ホストをカンマ区切りで指定できる", () => {
    const result = resolveEmailLinkBaseUrl(
      {
        EMAIL_LINK_BASE_URL: "https://second.example.com",
        EMAIL_LINK_ALLOWED_HOSTS: "first.example.com, second.example.com ,third.example.com",
      },
      "https://test.dentshift.jp"
    );
    expect(result).toBe("https://second.example.com");
  });
});
