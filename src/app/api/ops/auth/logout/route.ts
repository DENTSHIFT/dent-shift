import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { destroyOperatorSessionByToken, OPERATOR_SESSION_COOKIE } from "@/server/auth/operatorSession";

export async function POST() {
  const store = await cookies();
  const token = store.get(OPERATOR_SESSION_COOKIE)?.value;
  if (token) {
    await destroyOperatorSessionByToken(token);
    store.delete(OPERATOR_SESSION_COOKIE);
  }
  return NextResponse.json({ ok: true });
}
