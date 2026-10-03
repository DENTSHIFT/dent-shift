import "server-only";

/**
 * SMS実送信の対象限定ガード(非本番環境では必須)。
 *
 * `SMS_PROVIDER`はプロセス全体のグローバル設定であり、`smsVerificationExempt`は
 * 保護ページへのアクセス許可を制御するだけでSMS送信自体を防がない。そのため、
 * `dent-shift-test`のような共有テスト環境でSMS_PROVIDERを有効化すると、対象外の
 * 利用者が偶然SMS認証フローに到達しても実際に送信されてしまう(2026-10-03調査)。
 *
 * 2026-10-03訂正: 当初は`SMS_TEST_SEND_ALLOWLIST_ENABLED`という明示フラグ未設定なら
 * 常に許可する設計だったが、これは「設定漏れが送信許可になる」という安全側と逆の
 * 挙動だったため撤回する。
 *
 * 環境識別は`VERCEL_ENV`(test.dentshift.jpも"production"を返すため使えない)ではなく、
 * `APP_BASE_URL`のホスト名で行う(`resultEmailConfig.ts`のEMAIL_LINK_ALLOWED_HOSTS、
 * `docs/PRODUCTION_MIGRATION_PLAN_2026-10-03.md`の対象環境表と同じ、このコードベース
 * 既存の判定方法)。本番ドメイン(dentshift.jp/www.dentshift.jp/app.dentshift.jp)の
 * 場合のみガードは無効(従来どおり無条件で送信、本番の既存動作を一切変えない)。
 * それ以外(test.dentshift.jp、Vercel Preview URL、APP_BASE_URL未設定・不正な場合を
 * 含む全て)では、許可リストとの一致が**必須**になる。
 */
const PRODUCTION_HOSTS = new Set(["dentshift.jp", "www.dentshift.jp", "app.dentshift.jp"]);

export function isKnownProductionHost(env: Record<string, string | undefined> = process.env): boolean {
  try {
    const host = new URL(env.APP_BASE_URL ?? "").host.toLowerCase();
    return PRODUCTION_HOSTS.has(host);
  } catch {
    // APP_BASE_URL未設定・不正な場合は本番と断定しない(非本番として扱い、ガードを必須にする)。
    return false;
  }
}

export interface SmsSendAllowlistCheck {
  contactId: string;
  /** 実際に送信先として使うサーバー側の値(クライアント入力をそのまま渡さないこと)。 */
  phoneNumberE164: string;
}

/**
 * 指定されたContact ID・電話番号の組み合わせで送信してよいかどうかを判定する。
 * - 本番ドメイン(APP_BASE_URLのホストがPRODUCTION_HOSTSに含まれる)では常にtrue
 *   (従来どおり無条件で送信、本番の既存動作を変えない)。
 * - それ以外の環境では、許可リスト(SMS_TEST_ALLOWED_CONTACT_ID・SMS_TEST_ALLOWED_PHONE)
 *   が両方設定されていて、かつ両方が一致した場合のみtrue。未設定・不正な形式・
 *   いずれか一方でも不一致ならfalse(拒否)。
 */
export function isSmsSendAllowed(
  check: SmsSendAllowlistCheck,
  env: Record<string, string | undefined> = process.env
): boolean {
  if (isKnownProductionHost(env)) return true;

  const allowedContactId = env.SMS_TEST_ALLOWED_CONTACT_ID?.trim();
  const allowedPhone = env.SMS_TEST_ALLOWED_PHONE?.trim();
  if (!allowedContactId || !allowedPhone) return false;
  // E.164形式(+に続く数字のみ)以外は不正な形式として拒否する。
  if (!/^\+[1-9]\d{6,14}$/.test(allowedPhone)) return false;

  return check.contactId === allowedContactId && check.phoneNumberE164 === allowedPhone;
}
