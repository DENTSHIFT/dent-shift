import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { destroySessionByToken, SESSION_COOKIE } from "@/server/auth/session";

export async function POST() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await destroySessionByToken(token);
    store.delete(SESSION_COOKIE);
  }
  return NextResponse.json({ ok: true });
}
