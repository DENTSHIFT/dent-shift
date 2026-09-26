import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db/prismaClient";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { hashContactPasswordResetToken } from "@/server/auth/contactPasswordResetToken";
import { validatePassword } from "@/domain/auth/passwordPolicy";

const INVALID_TOKEN_MESSAGE =
  "このリンクは無効か、有効期限が切れています。もう一度パスワード再設定をお試しください。";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "リクエストボディがJSONとして解釈できません" }, { status: 400 });
  }
  const { token, newPassword } = (body ?? {}) as Record<string, unknown>;
  if (typeof token !== "string" || !token) {
    return NextResponse.json({ error: INVALID_TOKEN_MESSAGE }, { status: 400 });
  }
  if (typeof newPassword !== "string") {
    return NextResponse.json({ error: "パスワードを入力してください" }, { status: 400 });
  }

  const contact = await prisma.contact.findFirst({
    where: { passwordResetTokenHash: hashContactPasswordResetToken(token) },
  });
  if (!contact || !contact.passwordResetExpiresAt || contact.passwordResetExpiresAt.getTime() < Date.now()) {
    return NextResponse.json({ error: INVALID_TOKEN_MESSAGE }, { status: 400 });
  }

  const validation = validatePassword(newPassword);
  if (!validation.valid) {
    return NextResponse.json({ error: validation.reason }, { status: 400 });
  }
  if (await verifyPassword(newPassword, contact.passwordHash)) {
    return NextResponse.json({ error: "現在のパスワードと異なるパスワードを設定してください" }, { status: 400 });
  }

  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction([
    prisma.contact.update({
      where: { id: contact.id },
      data: {
        passwordHash,
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null,
        passwordResetSmsSentAt: null,
        passwordResetSmsAttemptCount: 0,
      },
    }),
    prisma.session.deleteMany({ where: { contactId: contact.id } }),
  ]);
  return NextResponse.json({ ok: true }, { status: 200 });
}
