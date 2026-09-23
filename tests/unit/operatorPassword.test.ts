import { describe, expect, it } from "vitest";
import {
  validateOperatorPassword,
  OPERATOR_PASSWORD_REQUIREMENTS_MESSAGE,
} from "@/domain/auth/operatorPassword";

describe("validateOperatorPassword", () => {
  it("英字+数字8文字以上ならvalid", () => {
    expect(validateOperatorPassword("Dentshift123")).toEqual({ valid: true });
  });

  it("英字+数字ちょうど8文字ならvalid", () => {
    expect(validateOperatorPassword("abc12345")).toEqual({ valid: true });
  });

  it("数字のみ(英字なし)は拒否", () => {
    expect(validateOperatorPassword("12345678")).toEqual({
      valid: false,
      reason: OPERATOR_PASSWORD_REQUIREMENTS_MESSAGE,
    });
  });

  it("英字のみ(数字なし)は拒否", () => {
    expect(validateOperatorPassword("abcdefgh")).toEqual({
      valid: false,
      reason: OPERATOR_PASSWORD_REQUIREMENTS_MESSAGE,
    });
  });

  it("7文字以下は拒否", () => {
    expect(validateOperatorPassword("abc1234")).toEqual({
      valid: false,
      reason: OPERATOR_PASSWORD_REQUIREMENTS_MESSAGE,
    });
  });

  it("記号を含んでいてもvalid", () => {
    expect(validateOperatorPassword("abc123!?")).toEqual({ valid: true });
  });

  it("絵文字を含まなくてもvalid(絵文字は必須ではない)", () => {
    expect(validateOperatorPassword("abcdefg1")).toEqual({ valid: true });
  });

  it("空白のみは拒否", () => {
    expect(validateOperatorPassword("        ")).toEqual({
      valid: false,
      reason: "パスワードを入力してください",
    });
  });

  it("極端に単純な値(よくある弱いパスワード文字列)は、英字+数字の要件を満たしていても拒否", () => {
    expect(validateOperatorPassword("password1")).toEqual({
      valid: false,
      reason: "単純すぎるパスワードは使用できません",
    });
  });

  it("現在のパスワードと同一なら拒否", () => {
    expect(validateOperatorPassword("abcd1234", "abcd1234")).toEqual({
      valid: false,
      reason: "現在のパスワードと異なるパスワードを設定してください",
    });
  });

  it("現在のパスワードと異なれば許可", () => {
    expect(validateOperatorPassword("abcd1234", "different99")).toEqual({ valid: true });
  });
});
