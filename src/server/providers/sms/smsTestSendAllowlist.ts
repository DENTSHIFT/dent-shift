import "server-only";

/**
 * SMS実送信の対象限定ガード(テスト環境限定)。
 *
 * `dent-shift-test`のようなSMS_PROVIDERを共有するテスト環境で、SMS_PROVIDER自体は
 * プロセス全体のグローバル設定であり、対象外の利用者が偶然SMS認証フローに到達しても
 * 送信を止める仕組みがなかった(2026-10-03調査)。このモジュールは、Twilioへの実送信
 * 呼び出しの直前に挟む「最後の砦」として、許可されたContact ID・電話番号の両方が
 * 一致した場合だけ送信を許可する。
 *
 * 有効化は`SMS_TEST_SEND_ALLOWLIST_ENABLED=true`を明示的に設定した場合のみ。
 * 未設定(本番含む既存の全環境)では本モジュールは何もせず、既存の送信動作は
 * 一切変更しない。
 */
export function isSmsTestSendAllowlistEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.SMS_TEST_SEND_ALLOWLIST_ENABLED?.trim() === "true";
}

export interface SmsSendAllowlistCheck {
  contactId: string;
  /** 実際に送信先として使うサーバー側の値(クライアント入力をそのまま渡さないこと)。 */
  phoneNumberE164: string;
}

/**
 * ガードが有効な環境で、指定されたContact ID・電話番号の組み合わせが許可リストと
 * 一致するかどうかを判定する。
 * - ガード無効(SMS_TEST_SEND_ALLOWLIST_ENABLED未設定)の場合は常にtrue(素通り)。
 * - ガード有効時、許可リストが未設定・不正な形式・いずれか一方でも不一致なら false。
 */
export function isSmsSendAllowed(
  check: SmsSendAllowlistCheck,
  env: Record<string, string | undefined> = process.env
): boolean {
  if (!isSmsTestSendAllowlistEnabled(env)) return true;

  const allowedContactId = env.SMS_TEST_ALLOWED_CONTACT_ID?.trim();
  const allowedPhone = env.SMS_TEST_ALLOWED_PHONE?.trim();
  if (!allowedContactId || !allowedPhone) return false;
  // E.164形式(+に続く数字のみ)以外は不正な形式として拒否する。
  if (!/^\+[1-9]\d{6,14}$/.test(allowedPhone)) return false;

  return check.contactId === allowedContactId && check.phoneNumberE164 === allowedPhone;
}
