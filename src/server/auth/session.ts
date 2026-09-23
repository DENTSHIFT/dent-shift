import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "@/server/db/prismaClient";

// SECURITY.md「認証・テナント分離設計」: 電話番号を要求しない、メール+パスワードのセッション認証。
// JWTではなく、DBに紐づく不透明トークン(session token)方式にすることで、
// 追加ライブラリなしに即時失効(ログアウト・強制ログアウト)を可能にする。
export const SESSION_COOKIE = "ds_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30日

export async function createSession(contactId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({ data: { token, contactId, expiresAt } });
  // 運営側のパイロット医院モニタリング一覧(/ops/invites)で「最終ログイン」を
  // 表示するために記録する(ログイン・サインアップ直後の自動ログイン双方を含む)。
  await prisma.contact.update({ where: { id: contactId }, data: { lastLoginAt: new Date() } });
  return token;
}

export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/**
 * 現在のセッションに紐づくContact(clinicを含む)を返す。
 * 未ログイン・失効済みセッションの場合は null(呼び出し側でリダイレクト等を判断する)。
 */
export async function getCurrentContact() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { token },
    include: { contact: { include: { clinic: true } } },
  });

  if (!session || session.expiresAt < new Date()) {
    if (session) await prisma.session.delete({ where: { token } }).catch(() => {});
    return null;
  }

  return session.contact;
}

export async function destroySessionByToken(token: string): Promise<void> {
  await prisma.session.delete({ where: { token } }).catch(() => {});
}
