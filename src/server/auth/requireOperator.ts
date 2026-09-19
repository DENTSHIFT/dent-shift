import { redirect } from "next/navigation";
import { getCurrentOperator } from "./operatorSession";

/**
 * 運営側(app/(ops)配下)の保護ページで使う。医院側requireContact.tsと同型だが、
 * 別の認証ドメイン(Operator)を参照する(SECURITY.md参照)。
 */
export async function requireOperator() {
  const operator = await getCurrentOperator();
  if (!operator) redirect("/ops/login");
  return operator;
}
