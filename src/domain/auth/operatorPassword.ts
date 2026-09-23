/**
 * 運営者(Operator)パスワードの強度検証(2026-09-23追加)。
 * クライアント側(フォーム)・サーバー側(APIルート)の両方から同じ関数を呼び、
 * 判定基準がずれないようにする。
 */

export const OPERATOR_PASSWORD_REQUIREMENTS_MESSAGE =
  "8文字以上、数字1文字以上、絵文字1文字以上を含めてください";

const DIGIT_PATTERN = /[0-9]/;
// Extended_Pictographic は絵文字全般(顔文字・記号ピクトグラム等)を広くカバーする。
const EMOJI_PATTERN = /\p{Extended_Pictographic}/u;

export type OperatorPasswordValidationResult =
  | { valid: true }
  | { valid: false; reason: string };

/**
 * 「極端に単純な値」の簡易判定: 全文字が1種類だけ(例: "aaaaaaaa")、または
 * よくある連番・弱いパスワード文字列そのもの。厳密なパスワード強度計算は行わず、
 * 明らかに弱いものだけを機械的に弾く。
 */
function isTriviallyWeak(password: string): boolean {
  if (new Set(password).size === 1) return true;
  const lower = password.toLowerCase();
  const commonWeakValues = [
    "12345678",
    "123456789",
    "password",
    "password1",
    "qwertyui",
    "11111111",
    "00000000",
  ];
  return commonWeakValues.includes(lower);
}

export function validateOperatorPassword(
  password: string,
  currentPassword?: string
): OperatorPasswordValidationResult {
  if (password.trim().length === 0) {
    return { valid: false, reason: "パスワードを入力してください" };
  }
  if (password.length < 8) {
    return { valid: false, reason: OPERATOR_PASSWORD_REQUIREMENTS_MESSAGE };
  }
  if (isTriviallyWeak(password)) {
    return { valid: false, reason: "単純すぎるパスワードは使用できません" };
  }
  if (!DIGIT_PATTERN.test(password)) {
    return { valid: false, reason: OPERATOR_PASSWORD_REQUIREMENTS_MESSAGE };
  }
  if (!EMOJI_PATTERN.test(password)) {
    return { valid: false, reason: OPERATOR_PASSWORD_REQUIREMENTS_MESSAGE };
  }
  if (currentPassword !== undefined && password === currentPassword) {
    return { valid: false, reason: "現在のパスワードと異なるパスワードを設定してください" };
  }
  return { valid: true };
}
