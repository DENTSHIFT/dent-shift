import { describe, expect, it } from "vitest";
import { PhoneNumberFormatError, normalizeJapanesePhoneNumberToE164 } from "@/domain/auth/phoneNumber";

describe("normalizeJapanesePhoneNumberToE164", () => {
  it("ハイフン区切りの携帯番号をE.164へ正規化する", () => {
    expect(normalizeJapanesePhoneNumberToE164("090-1234-5678")).toBe("+819012345678");
  });

  it("スペース区切りの携帯番号をE.164へ正規化する", () => {
    expect(normalizeJapanesePhoneNumberToE164("080 1234 5678")).toBe("+818012345678");
  });

  it("既にE.164形式ならそのまま返す", () => {
    expect(normalizeJapanesePhoneNumberToE164("+817012345678")).toBe("+817012345678");
  });

  it("固定電話番号(携帯以外)を拒否する", () => {
    expect(() => normalizeJapanesePhoneNumberToE164("03-1234-5678")).toThrow(
      PhoneNumberFormatError
    );
  });

  it("桁数が不正な番号を拒否する", () => {
    expect(() => normalizeJapanesePhoneNumberToE164("090-1234-567")).toThrow(
      PhoneNumberFormatError
    );
  });

  it("空文字を拒否する", () => {
    expect(() => normalizeJapanesePhoneNumberToE164("")).toThrow(PhoneNumberFormatError);
  });
});
