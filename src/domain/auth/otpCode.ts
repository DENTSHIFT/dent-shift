// SMS認証コード(Twilio Verify)の入力整形・検証。コード長はVerify Serviceの設定で4〜10桁。
export const OTP_CODE_MIN_LENGTH = 4;
export const OTP_CODE_MAX_LENGTH = 10;

export const OTP_CODE_HINT = "SMSに記載の数字(通常6桁)を入力してください。";
export const OTP_LOOKS_LIKE_PHONE_MESSAGE =
  "電話番号ではなく、SMSに記載された認証コード(数字)を入力してください。";
export const OTP_INVALID_FORMAT_MESSAGE = `認証コードの形式が正しくありません。${OTP_CODE_HINT}`;

// 全角数字を半角にし、空白・ハイフンを除く(SMSからのコピー時の混入対策)。
export function normalizeOtpInput(raw: string): string {
  return raw
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\s\-‐－]/g, "");
}

export type OtpValidation =
  | { ok: true; code: string }
  | { ok: false; reason: "phone_like" | "format" };

export function validateOtpCode(raw: string): OtpValidation {
  const code = normalizeOtpInput(raw);
  // 携帯番号(0または+81始まり)と取り違えた入力を、Twilioへ送る前に弾く。
  if (/^(0\d{9,10}|\+?81\d{9,10})$/.test(code) || raw.includes("+")) {
    return { ok: false, reason: "phone_like" };
  }
  if (!new RegExp(`^\\d{${OTP_CODE_MIN_LENGTH},${OTP_CODE_MAX_LENGTH}}$`).test(code)) {
    return { ok: false, reason: "format" };
  }
  return { ok: true, code };
}
