// 紹介コードの表記ゆれ吸収(大文字化・前後空白除去)と形式検証。
// 実際の発行ルール(桁数・文字種の最終仕様)は未確定のため、暫定的に
// 英数字6〜12桁のみを許可する(ユーザー確定仕様が判明次第見直す)。
const REFERRAL_CODE_RE = /^[A-Z0-9]{6,12}$/;

export class ReferralCodeFormatError extends Error {}

export function normalizeReferralCode(rawValue: string): string {
  const normalized = rawValue.trim().toUpperCase();
  if (!REFERRAL_CODE_RE.test(normalized)) {
    throw new ReferralCodeFormatError("紹介コードの形式が正しくありません");
  }
  return normalized;
}
