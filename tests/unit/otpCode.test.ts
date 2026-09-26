import { describe, expect, it } from "vitest";
import { normalizeOtpInput, validateOtpCode } from "@/domain/auth/otpCode";

describe("validateOtpCode", () => {
  it("4〜10桁の数字を受け付ける(全角・空白・ハイフンは整形)", () => {
    expect(validateOtpCode("123456")).toEqual({ ok: true, code: "123456" });
    expect(validateOtpCode(" １２３ 456 ")).toEqual({ ok: true, code: "123456" });
    expect(validateOtpCode("123-456")).toEqual({ ok: true, code: "123456" });
    expect(normalizeOtpInput("１２３")).toBe("123");
  });
  it("携帯番号のような入力は phone_like として弾く", () => {
    expect(validateOtpCode("09012345678")).toEqual({ ok: false, reason: "phone_like" });
    expect(validateOtpCode("090-1234-5678")).toEqual({ ok: false, reason: "phone_like" });
    expect(validateOtpCode("+819012345678")).toEqual({ ok: false, reason: "phone_like" });
  });
  it("数字以外・短すぎ・長すぎは format として弾く", () => {
    for (const bad of ["abc123", "12", "12345678901", ""]) {
      expect(validateOtpCode(bad)).toEqual({ ok: false, reason: "format" });
    }
  });
});
