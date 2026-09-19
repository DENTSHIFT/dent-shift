import { describe, expect, it } from "vitest";
import {
  isHostOrSubdomainOfOfficialHost,
  isSameNormalizedUrl,
  isSameOfficialDomain,
  normalizeUrl,
} from "@/domain/ai-measurement/urlNormalization";

/**
 * URL正規化のunit test(設計書G章: www有無/trailing slash/query parameter/fragment/
 * protocol/大文字小文字の違いを比較に影響させないことを検証する)。
 */
describe("normalizeUrl", () => {
  it("www有無を同一hostとして正規化する", () => {
    const a = normalizeUrl("https://www.example.com/");
    const b = normalizeUrl("https://example.com/");
    expect(a).not.toBeNull();
    expect(a!.host).toBe(b!.host);
  });

  it("trailing slashの有無を同一pathとして正規化する", () => {
    const a = normalizeUrl("https://example.com/about");
    const b = normalizeUrl("https://example.com/about/");
    expect(a!.path).toBe(b!.path);
  });

  it("ルートパスはtrailing slashを除去せず\"/\"のまま保持する", () => {
    expect(normalizeUrl("https://example.com")!.path).toBe("/");
    expect(normalizeUrl("https://example.com/")!.path).toBe("/");
  });

  it("大文字小文字の違いを無視してhostを比較できる", () => {
    const a = normalizeUrl("https://Example.COM/");
    const b = normalizeUrl("https://example.com/");
    expect(a!.host).toBe(b!.host);
  });

  it("protocolの違い(http/https)を比較に影響させない", () => {
    const a = normalizeUrl("http://example.com/");
    const b = normalizeUrl("https://example.com/");
    expect(a!.host).toBe(b!.host);
    expect(a!.path).toBe(b!.path);
  });

  it("不正なURLはnullを返す(判定不能を握りつぶさない)", () => {
    expect(normalizeUrl("not a url at all ///")).toBeNull();
  });
});

describe("isSameNormalizedUrl", () => {
  it("query parameterの違いを無視して同一URLと判定する", () => {
    expect(
      isSameNormalizedUrl(
        "https://example.com/page?utm_source=chat",
        "https://example.com/page"
      )
    ).toBe(true);
  });

  it("fragmentの違いを無視して同一URLと判定する", () => {
    expect(isSameNormalizedUrl("https://example.com/page#section2", "https://example.com/page")).toBe(
      true
    );
  });

  it("pathが異なれば別URLと判定する", () => {
    expect(isSameNormalizedUrl("https://example.com/a", "https://example.com/b")).toBe(false);
  });
});

describe("isSameOfficialDomain(2026-09-07のユーザー指示: P0のsubdomain扱いを確定)", () => {
  it("www有無・trailing slash・query parameterが異なっても同一公式ドメインと判定する", () => {
    expect(
      isSameOfficialDomain(
        "https://www.sakura-dental-clinic.example.com/?utm_source=chat",
        "https://sakura-dental-clinic.example.com"
      )
    ).toBe(true);
  });

  it("パスが異なっても(ドメインのみ見るため)同一公式ドメインと判定する", () => {
    expect(
      isSameOfficialDomain(
        "https://sakura-dental-clinic.example.com/reviews",
        "https://sakura-dental-clinic.example.com/"
      )
    ).toBe(true);
  });

  it("official hostの正式なsubdomainは同一公式ドメインとして許可する(例: reserve./blog.)", () => {
    expect(
      isSameOfficialDomain(
        "https://reserve.sakura-dental-clinic.example.com/",
        "https://sakura-dental-clinic.example.com/"
      )
    ).toBe(true);
    expect(
      isSameOfficialDomain(
        "https://blog.sakura-dental-clinic.example.com/",
        "https://sakura-dental-clinic.example.com/"
      )
    ).toBe(true);
  });

  it("official hostをハイフンで連結しただけの別ドメイン(prefix攻撃)は一致させない", () => {
    // "evil-sakura-dental-clinic.example.com" は末尾に "sakura-dental-clinic.example.com"
    // という文字列を含むが、"."境界を挟まないため別ドメインとして扱う。
    expect(
      isSameOfficialDomain(
        "https://evil-sakura-dental-clinic.example.com/",
        "https://sakura-dental-clinic.example.com/"
      )
    ).toBe(false);
  });

  it("official hostを別ドメインの一部として連結しただけのURL(suffix攻撃)は一致させない", () => {
    expect(
      isSameOfficialDomain(
        "https://sakura-dental-clinic.example.com.evil.example.net/",
        "https://sakura-dental-clinic.example.com/"
      )
    ).toBe(false);
  });

  it("全く異なるドメインはfalseと判定する", () => {
    expect(
      isSameOfficialDomain(
        "https://midori-shika.example.com/",
        "https://sakura-dental-clinic.example.com/"
      )
    ).toBe(false);
  });
});


describe("isHostOrSubdomainOfOfficialHost(境界判定そのものをユーザー指示の具体例で確認)", () => {
  const officialHost = "example-clinic.jp";

  it("official host自身は許可する", () => {
    expect(isHostOrSubdomainOfOfficialHost("example-clinic.jp", officialHost)).toBe(true);
  });

  it("正式なsubdomainは許可する(reserve./blog.)", () => {
    expect(isHostOrSubdomainOfOfficialHost("reserve.example-clinic.jp", officialHost)).toBe(true);
    expect(isHostOrSubdomainOfOfficialHost("blog.example-clinic.jp", officialHost)).toBe(true);
  });

  it("official hostを別ドメインの先頭部分として連結しただけのURLは許可しない", () => {
    expect(
      isHostOrSubdomainOfOfficialHost("example-clinic.jp.other-domain.com", officialHost)
    ).toBe(false);
  });

  it("全く異なるドメインは許可しない", () => {
    expect(isHostOrSubdomainOfOfficialHost("example.com", officialHost)).toBe(false);
  });

  it('ハイフンでofficial hostへ連結しただけの別ドメイン(evil-example-clinic.jp)は"."境界が無いため許可しない', () => {
    expect(isHostOrSubdomainOfOfficialHost("evil-example-clinic.jp", officialHost)).toBe(false);
  });
});
