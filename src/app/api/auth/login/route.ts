import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db/prismaClient";
import { verifyPassword } from "@/server/auth/password";
import { createSession, setSessionCookie } from "@/server/auth/session";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "リクエストボディがJSONとして解釈できません" }, { status: 400 });
  }

  const { email, password } = (body ?? {}) as Record<string, unknown>;
  if (typeof email !== "string" || typeof password !== "string") {
    return NextResponse.json({ error: "メールアドレスとパスワードを入力してください" }, { status: 400 });
  }

  const contact = await prisma.contact.findUnique({ where: { email: email.trim() } });
  // メールの存在有無を応答差で漏らさないため、存在チェックとパスワード検証を同じエラーに畳む
  const passwordOk = contact ? await verifyPassword(password, contact.passwordHash) : false;

  if (!contact || !passwordOk) {
    return NextResponse.json({ error: "メールアドレスまたはパスワードが正しくありません" }, { status: 401 });
  }

  const token = await createSession(contact.id);
  await setSessionCookie(token);

  return NextResponse.json({ contactId: contact.id, clinicId: contact.clinicId }, { status: 200 });
}
