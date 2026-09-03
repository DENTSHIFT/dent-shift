import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db/prismaClient";
import { hashPassword } from "@/server/auth/password";
import { createSession, setSessionCookie } from "@/server/auth/session";

export class InvalidSignupInputError extends Error {}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Step4: 無料会員登録。
 * - clinicId が渡された場合: 無料診断済みの既存Clinicにこのアカウントを紐づける
 * - 渡されない場合: 医院名+URLで新規Clinicを作成してから紐づける
 * 電話番号は一切要求しない(引き継ぎ書3章-4)。
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "リクエストボディがJSONとして解釈できません" }, { status: 400 });
  }

  const { email, password, clinicId, clinicName, clinicUrl } = (body ?? {}) as Record<string, unknown>;

  if (typeof email !== "string" || !EMAIL_RE.test(email.trim())) {
    return NextResponse.json({ error: "メールアドレスの形式が正しくありません" }, { status: 400 });
  }
  if (typeof password !== "string" || password.length < 8) {
    return NextResponse.json({ error: "パスワードは8文字以上で入力してください" }, { status: 400 });
  }
  if (clinicId !== undefined && (typeof clinicId !== "string" || !clinicId)) {
    return NextResponse.json({ error: "clinicIdの形式が不正です" }, { status: 400 });
  }

  const normalizedEmail = email.trim();
  const existing = await prisma.contact.findUnique({ where: { email: normalizedEmail } });
  if (existing) {
    return NextResponse.json({ error: "このメールアドレスは既に登録されています" }, { status: 409 });
  }

  let resolvedClinicId: string;

  if (typeof clinicId === "string" && clinicId) {
    const clinic = await prisma.clinic.findUnique({ where: { id: clinicId } });
    if (!clinic) {
      return NextResponse.json({ error: "指定された医院が見つかりません" }, { status: 404 });
    }
    resolvedClinicId = clinic.id;
  } else {
    if (typeof clinicName !== "string" || !clinicName.trim()) {
      return NextResponse.json({ error: "医院名は必須です" }, { status: 400 });
    }
    if (typeof clinicUrl !== "string" || !/^https?:\/\//.test(clinicUrl.trim())) {
      return NextResponse.json(
        { error: "公式サイトURLは http(s):// から始まる形式で入力してください" },
        { status: 400 }
      );
    }
    const clinic = await prisma.clinic.create({
      data: { name: clinicName.trim(), url: clinicUrl.trim() },
    });
    resolvedClinicId = clinic.id;
  }

  const passwordHash = await hashPassword(password);
  const contact = await prisma.contact.create({
    data: {
      email: normalizedEmail,
      passwordHash,
      clinicId: resolvedClinicId,
      role: "owner",
    },
  });

  const token = await createSession(contact.id);
  await setSessionCookie(token);

  return NextResponse.json({ contactId: contact.id, clinicId: resolvedClinicId }, { status: 201 });
}
