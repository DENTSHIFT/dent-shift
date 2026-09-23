import { describe, expect, it } from "vitest";
import {
  validateOperatorPassword,
  OPERATOR_PASSWORD_REQUIREMENTS_MESSAGE,
} from "@/domain/auth/operatorPassword";

describe("validateOperatorPassword", () => {
  it("8文字以上・数字1文字以上・絵文字1文字以上を満たせばvalid", () => {
    expect(validateOperatorPassword("abcd123🔥")).toEqual({ valid: true });
  });

  it("8文字未満は拒否", () => {
    expect(validateOperatorPassword("a1🔥")).toEqual({
      valid: false,
      reason: OPERATOR_PASSWORD_REQUIREMENTS_MESSAGE,
    });
  });

  it("数字を含まなければ拒否", () => {
    expect(validateOperatorPassword("abcdefgh🔥")).toEqual({
      valid: false,
      reason: OPERATOR_PASSWORD_REQUIREMENTS_MESSAGE,
    });
  });

  it("絵文字を含まなければ拒否", () => {
    expect(validateOperatorPassword("abcdefg1")).toEqual({
      valid: false,
      reason: OPERATOR_PASSWORD_REQUIREMENTS_MESSAGE,
    });
  });

  it("空白のみは拒否", () => {
    expect(validateOperatorPassword("        ")).toEqual({
      valid: false,
      reason: "パスワードを入力してください",
    });
  });

  it("極端に単純な値(同一文字の繰り返し)は拒否", () => {
    expect(validateOperatorPassword("11111111")).toEqual({
      valid: false,
      reason: "単純すぎるパスワードは使用できません",
    });
  });

  it("現在のパスワードと同一なら拒否", () => {
    expect(validateOperatorPassword("abcd123🔥", "abcd123🔥")).toEqual({
      valid: false,
      reason: "現在のパスワードと異なるパスワードを設定してください",
    });
  });

  it("現在のパスワードと異なれば許可", () => {
    expect(validateOperatorPassword("abcd123🔥", "different1🎉")).toEqual({ valid: true });
  });
});
