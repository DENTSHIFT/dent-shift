import { redirect } from "next/navigation";
import { getCurrentContact } from "./session";

/**
 * 医院側の保護ページ(サーバーコンポーネント)で使う。未ログインなら/loginへリダイレクトする。
 * clinic_idベースのテナント分離(SECURITY.md)は、返されたcontact.clinicIdを
 * 呼び出し側のクエリで必ず使うことで担保する。
 */
export async function requireContact() {
  const contact = await getCurrentContact();
  if (!contact) redirect("/login");
  return contact;
}
