import { redirect } from "next/navigation";
import { getCurrentContact } from "./session";

/**
 * 医院側の保護ページ(サーバーコンポーネント)で使う。未ログインなら/loginへリダイレクトする。
 * clinic_idベースのテナント分離(SECURITY.md)は、返されたcontact.clinicIdを
 * 呼び出し側のクエリで必ず使うことで担保する。
 *
 * 2026-09-24: SMS未認証のままURL直打ちでdashboard等に到達できてしまう抜け道を塞ぐため、
 * 既定でphoneVerifiedAtも必須にする(未認証なら/verify-phoneへ、nextを保持してリダイレクト)。
 * /verify-phoneページ自身はrequirePhoneVerified:falseで呼び出し、無限リダイレクトを避ける。
 *
 * 2026-09-24: smsVerificationExempt(Contact単位の限定例外、運営がDBで個別設定)が
 * trueの場合はphoneVerifiedAt必須チェックをスキップする。Twilio審査停止等でSMS認証
 * 自体が利用できない特定医院向けの救済であり、全ユーザー一律の無効化ではない。
 */
export async function requireContact(options?: { requirePhoneVerified?: boolean; next?: string }) {
  const contact = await getCurrentContact();
  if (!contact) redirect("/login");

  const requirePhoneVerified = options?.requirePhoneVerified ?? true;
  if (requirePhoneVerified && !contact.phoneVerifiedAt && !contact.smsVerificationExempt) {
    redirect(options?.next ? `/verify-phone?next=${encodeURIComponent(options.next)}` : "/verify-phone");
  }

  return contact;
}
