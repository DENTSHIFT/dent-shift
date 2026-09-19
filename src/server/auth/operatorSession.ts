import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "@/server/db/prismaClient";

// SECURITY.md「運営側の権限をエンドユーザー向けAPIキーやセッションと混在させない」ため、
// 医院側session.tsとはCookie名・テーブルを完全に分離する(OperatorSession、別モデル)。
export const OPERATOR_SESSION_COOKIE = "ds_ops_session";
const OPERATOR_SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12時間(医院側より短い。社内利用のため)

export async function createOperatorSession(operatorId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + OPERATOR_SESSION_TTL_MS);
  await prisma.operatorSession.create({ data: { token, operatorId, expiresAt } });
  return token;
}

export async function setOperatorSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(OPERATOR_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: OPERATOR_SESSION_TTL_MS / 1000,
  });
}

export async function clearOperatorSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(OPERATOR_SESSION_COOKIE);
}

export async function getCurrentOperator() {
  const store = await cookies();
  const token = store.get(OPERATOR_SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.operatorSession.findUnique({
    where: { token },
    include: { operator: true },
  });

  if (!session || session.expiresAt < new Date()) {
    if (session) await prisma.operatorSession.delete({ where: { token } }).catch(() => {});
    return null;
  }

  return session.operator;
}

export async function destroyOperatorSessionByToken(token: string): Promise<void> {
  await prisma.operatorSession.delete({ where: { token } }).catch(() => {});
}
