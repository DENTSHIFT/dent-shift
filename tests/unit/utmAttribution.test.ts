import { describe, expect, it } from "vitest";
import {
  UTM_PARAM_KEYS,
  sanitizeUtmValue,
  sanitizeUtmAttribution,
  sanitizeUtmAttributionFromSearchParams,
} from "@/domain/marketing/utmAttribution";

describe("UTM_PARAM_KEYS", () => {
  it("5項目である(utm_source/medium/campaign/content/term)", () => {
    expect(UTM_PARAM_KEYS).toEqual(["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]);
  });
});

describe("sanitizeUtmValue: 長さ・文字種制限", () => {
  it("英数字・._~%+-のみで100文字以内の値はそのまま採用する", () => {
    expect(sanitizeUtmValue("instagram")).toBe("instagram");
    expect(sanitizeUtmValue("ig-story_2026.09%20launch+promo")).toBe(
      "ig-story_2026.09%20launch+promo"
    );
  });

  it("101文字以上の値はnullにする(部分的に切り詰めない)", () => {
    expect(sanitizeUtmValue("a".repeat(101))).toBeNull();
    expect(sanitizeUtmValue("a".repeat(100))).toBe("a".repeat(100));
  });

  it("空文字・空白のみはnullにする", () => {
    expect(sanitizeUtmValue("")).toBeNull();
    expect(sanitizeUtmValue("   ")).toBeNull();
  });

  it("許可外の文字種(スペース・日本語・HTMLメタ文字)を含む値はnullにする(部分採用しない)", () => {
    expect(sanitizeUtmValue("instagram post")).toBeNull();
    expect(sanitizeUtmValue("インスタグラム")).toBeNull();
    expect(sanitizeUtmValue("<script>alert(1)</script>")).toBeNull();
    expect(sanitizeUtmValue("a&b")).toBeNull();
  });

  it("文字列以外(数値・null・オブジェクト)はnullにする", () => {
    expect(sanitizeUtmValue(12345)).toBeNull();
    expect(sanitizeUtmValue(null)).toBeNull();
    expect(sanitizeUtmValue(undefined)).toBeNull();
    expect(sanitizeUtmValue({ a: 1 })).toBeNull();
  });
});

describe("sanitizeUtmAttribution", () => {
  it("camelCase(utmSource等)とsnake_case(utm_source等)のどちらの入力形式も受け付ける", () => {
    expect(
      sanitizeUtmAttribution({
        utmSource: "instagram",
        utmMedium: "profile",
        utmCampaign: "launch",
        utmContent: "bio-link",
        utmTerm: "ai-diagnosis",
      })
    ).toEqual({
      utm_source: "instagram",
      utm_medium: "profile",
      utm_campaign: "launch",
      utm_content: "bio-link",
      utm_term: "ai-diagnosis",
    });

    expect(
      sanitizeUtmAttribution({
        utm_source: "instagram",
        utm_medium: "organic",
        utm_campaign: "launch",
        utm_content: "post-1",
        utm_term: "diagnosis",
      })
    ).toEqual({
      utm_source: "instagram",
      utm_medium: "organic",
      utm_campaign: "launch",
      utm_content: "post-1",
      utm_term: "diagnosis",
    });
  });

  it("未指定の項目はnullになり、常に5項目とも同じ形状のオブジェクトを返す", () => {
    expect(sanitizeUtmAttribution({})).toEqual({
      utm_source: null,
      utm_medium: null,
      utm_campaign: null,
      utm_content: null,
      utm_term: null,
    });
  });
});

describe("sanitizeUtmAttributionFromSearchParams", () => {
  it("URLSearchParamsから5項目を検証済みの形で取り出す", () => {
    const params = new URLSearchParams(
      "utm_source=instagram&utm_medium=paid_social&utm_campaign=launch&utm_content=story-ad&utm_term=ai+diagnosis"
    );
    // "ai+diagnosis" は URLSearchParams によりデコードされ "ai diagnosis"(スペース含む)になるため、
    // 文字種制限によりnullになる想定(個人が入力しうる自由記述語をそのまま許可しない安全側の挙動)。
    expect(sanitizeUtmAttributionFromSearchParams(params)).toEqual({
      utm_source: "instagram",
      utm_medium: "paid_social",
      utm_campaign: "launch",
      utm_content: "story-ad",
      utm_term: null,
    });
  });

  it("パラメータが無ければ全項目null", () => {
    expect(sanitizeUtmAttributionFromSearchParams(new URLSearchParams())).toEqual({
      utm_source: null,
      utm_medium: null,
      utm_campaign: null,
      utm_content: null,
      utm_term: null,
    });
  });
});
