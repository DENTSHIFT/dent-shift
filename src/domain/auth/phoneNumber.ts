// 日本向けの簡易E.164正規化。本格的な国際対応(libphonenumber等)は導入コストが
// 見合わないためP0スコープ外とし、日本の携帯電話番号(070/080/090)のみを対象にする。
const JAPAN_MOBILE_LOCAL_RE = /^0(70|80|90)\d{8}$/;
const E164_JAPAN_MOBILE_RE = /^\+81(70|80|90)\d{8}$/;

export class PhoneNumberFormatError extends Error {}

/**
 * "090-1234-5678" 等の表記ゆれを取り除き、E.164形式(+819012345678)へ正規化する。
 * 携帯電話番号として妥当な形式でなければ例外を投げる(SMS OTPの送信先として使うため)。
 */
export function normalizeJapanesePhoneNumberToE164(rawValue: string): string {
  const digitsOnly = rawValue.replace(/[\s\-()]/g, "");

  if (E164_JAPAN_MOBILE_RE.test(digitsOnly)) {
    return digitsOnly;
  }
  if (JAPAN_MOBILE_LOCAL_RE.test(digitsOnly)) {
    return `+81${digitsOnly.slice(1)}`;
  }
  throw new PhoneNumberFormatError(
    "携帯電話番号は070/080/090から始まる11桁の形式で入力してください"
  );
}
