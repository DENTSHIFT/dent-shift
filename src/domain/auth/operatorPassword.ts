/**
 * 運営者(Operator)パスワードの強度検証(2026-09-23追加)。
 * クライアント側(フォーム)・サーバー側(APIルート)の両方から同じ関数を呼び、
 * 判定基準がずれないようにする。
 */

export const OPERATOR_PASSWORD_REQUIREMENTS_MESSAGE =
  "8文字以上、英字1文字以上、数字1文字以上を含めてください";

const DIGIT_PATTERN = /[0-9]/;
const LETTER_PATTERN = /[a-zA-Z]/;

export type OperatorPasswordValidationResult =
  | { valid: true }
  | { valid: false; reason: string };

/**
 * 「極端に単純な値」の簡易判定。英字+数字の構成要件を満たした後でも残る、
 * よくある弱いパスワード文字列(例: "password1")だけを機械的に弾く。
 * 全文字が同一・数字のみ・英字のみといったパターンは、英字/数字の構成要件で
 * 既に弾かれるためここでは扱わない。
 */
function isTriviallyWeak(password: string): boolean {
  const commonWeakValues = ["password1", "password123", "qwerty123"];
  return commonWeakValues.includes(password.toLowerCase());
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
  if (!LETTER_PATTERN.test(password)) {
    return { valid: false, reason: OPERATOR_PASSWORD_REQUIREMENTS_MESSAGE };
  }
  if (!DIGIT_PATTERN.test(password)) {
    return { valid: false, reason: OPERATOR_PASSWORD_REQUIREMENTS_MESSAGE };
  }
  // 英字+数字の構成を満たした上で、なお明らかに弱い値(例: "password1")だけを弾く。
  if (isTriviallyWeak(password)) {
    return { valid: false, reason: "単純すぎるパスワードは使用できません" };
  }
  if (currentPassword !== undefined && password === currentPassword) {
    return { valid: false, reason: "現在のパスワードと異なるパスワードを設定してください" };
  }
  return { valid: true };
}
