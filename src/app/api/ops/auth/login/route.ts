import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db/prismaClient";
import { verifyPassword } from "@/server/auth/password";
import { createOperatorSession, setOperatorSessionCookie } from "@/server/auth/operatorSession";
import { recordAuditLog } from "@/server/db/auditLogRepository";

/**
 * 運営側ログイン。Operatorアカウントは自己サインアップを提供せず、社内で個別発行する
 * (SECURITY.md「運営側は社内オペレーター」)。ログイン成功自体もクロステナント権限の
 * 行使起点として監査ログへ残す。
 */
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

  const operator = await prisma.operator.findUnique({ where: { email: email.trim() } });
  const passwordOk = operator ? await verifyPassword(password, operator.passwordHash) : false;

  if (!operator || !passwordOk) {
    return NextResponse.json({ error: "メールアドレスまたはパスワードが正しくありません" }, { status: 401 });
  }

  const token = await createOperatorSession(operator.id);
  await setOperatorSessionCookie(token);

  await recordAuditLog({
    operatorId: operator.id,
    action: "ops_login",
    targetType: "Operator",
    targetId: operator.id,
  }).catch((error) => {
    console.error("[POST /api/ops/auth/login] audit log recording failed:", error);
  });

  return NextResponse.json({ operatorId: operator.id, role: operator.role }, { status: 200 });
}
