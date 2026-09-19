const ALLOWED_PHONE_CHARACTERS = /^[0-9+()\-\s]+$/;

export function normalizeClinicContactPhone(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * 国内の医院代表番号を対象に、0から始まる10桁または11桁を許可する。
 * 表示用のハイフン・空白・括弧は入力時に許可し、保存時は入力表記を維持する。
 */
export function isValidClinicContactPhone(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || !ALLOWED_PHONE_CHARACTERS.test(trimmed)) return false;
  return /^0\d{9,10}$/.test(normalizeClinicContactPhone(trimmed));
}
