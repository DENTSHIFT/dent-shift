import { describe, expect, it } from "vitest";
import { HTTP_URL_NOTICE, changedClinicProfileFields, isInsecureHttpUrl, validateClinicProfileInput } from "@/domain/clinic/clinicProfile";

const valid = {
  name: "  テスト歯科  ",
  directorName: "山田 太郎",
  url: "https://example.com/",
  gbpUrl: "https://maps.google.com/?cid=1",
  bookingUrl: "",
  contactPhone: "03-1234-5678",
};

describe("validateClinicProfileInput", () => {
  it("正常な入力を整形して受け付ける(空の任意項目はnull)", () => {
    const result = validateClinicProfileInput(valid);
    expect(result).toEqual({
      ok: true,
      value: {
        name: "テスト歯科",
        directorName: "山田 太郎",
        url: "https://example.com/",
        gbpUrl: "https://maps.google.com/?cid=1",
        bookingUrl: null,
        contactPhone: "03-1234-5678",
      },
    });
  });
  it("必須項目(医院名・WebサイトURL)の未入力を検出する", () => {
    const result = validateClinicProfileInput({ ...valid, name: " ", url: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(["name", "url"]);
  });
  it("URLは http(s) のみ許可し、javascript: 等や不正な形式を拒否する", () => {
    for (const bad of ["javascript:alert(1)", "ftp://example.com", "example.com", "data:text/html,x"]) {
      const result = validateClinicProfileInput({ ...valid, url: bad });
      expect(result.ok, bad).toBe(false);
    }
    expect(validateClinicProfileInput({ ...valid, gbpUrl: "not a url" }).ok).toBe(false);
    expect(validateClinicProfileInput({ ...valid, bookingUrl: "javascript:x" }).ok).toBe(false);
  });
  it("文字数と電話番号の形式を検証する", () => {
    expect(validateClinicProfileInput({ ...valid, name: "あ".repeat(101) }).ok).toBe(false);
    expect(validateClinicProfileInput({ ...valid, directorName: "あ".repeat(51) }).ok).toBe(false);
    expect(validateClinicProfileInput({ ...valid, url: "https://e.com/" + "a".repeat(2100) }).ok).toBe(false);
    expect(validateClinicProfileInput({ ...valid, contactPhone: "abc" }).ok).toBe(false);
    expect(validateClinicProfileInput({ ...valid, contactPhone: "" }).ok).toBe(true);
  });
  it("文字列以外の値は空として扱い、必須エラーにする", () => {
    expect(validateClinicProfileInput({ name: 123, url: null }).ok).toBe(false);
    expect(validateClinicProfileInput(null).ok).toBe(false);
  });
});

describe("changedClinicProfileFields", () => {
  it("変更した項目名だけを返す", () => {
    const parsed = validateClinicProfileInput(valid);
    if (!parsed.ok) throw new Error("invalid");
    const before = { ...parsed.value, name: "旧名称", contactPhone: null };
    expect(changedClinicProfileFields(before, parsed.value)).toEqual(["name", "contactPhone"]);
  });
});

describe("isInsecureHttpUrl / HTTP_URL_NOTICE", () => {
  it("http:// だけを対象にし、https:// は対象外", () => {
    expect(isInsecureHttpUrl("http://example.com")).toBe(true);
    expect(isInsecureHttpUrl("  HTTP://example.com")).toBe(true);
    expect(isInsecureHttpUrl("https://example.com")).toBe(false);
    expect(isInsecureHttpUrl("")).toBe(false);
  });
  it("断定を避けた文言で、証明書を『ダウンロード』とは表現しない", () => {
    expect(HTTP_URL_NOTICE).toContain("HTTPSに対応していない可能性があります");
    expect(HTTP_URL_NOTICE).not.toContain("ダウンロード");
    expect(HTTP_URL_NOTICE).not.toContain("設定されていません");
  });
});
