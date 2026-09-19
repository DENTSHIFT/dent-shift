import { describe, expect, it } from "vitest";
import { ReferralCodeFormatError, normalizeReferralCode } from "@/domain/ambassador/referralCode";

describe("normalizeReferralCode", () => {
  it("小文字・前後空白を正規化する", () => {
    expect(normalizeReferralCode("  nene2026  ")).toBe("NENE2026");
  });

  it("6〜12桁の英数字を受け付ける", () => {
    expect(normalizeReferralCode("ABC123")).toBe("ABC123");
    expect(normalizeReferralCode("ABCDEFGHIJKL")).toBe("ABCDEFGHIJKL");
  });

  it("短すぎる/長すぎるコードを拒否する", () => {
    expect(() => normalizeReferralCode("AB1")).toThrow(ReferralCodeFormatError);
    expect(() => normalizeReferralCode("ABCDEFGHIJKLM")).toThrow(ReferralCodeFormatError);
  });

  it("記号を含むコードを拒否する", () => {
    expect(() => normalizeReferralCode("ABC-123")).toThrow(ReferralCodeFormatError);
  });
});
