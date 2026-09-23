import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db/prismaClient";
import { getCurrentOperator } from "@/server/auth/operatorSession";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { recordAuditLog } from "@/server/db/auditLogRepository";

/**
 * 運営側(Operator)本人によるパスワード変更(2026-09-23追加)。
 * 現在のパスワードでの再確認を必須にし、新しいパスワードは平文でログ・監査ログに残さない。
 */
export async function POST(request: NextRequest) {
  const operator = await getCurrentOperator();
  if (!operator) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "リクエストボディがJSONとして解釈できません" }, { status: 400 });
  }
  const { currentPassword, newPassword } = (body ?? {}) as Record<string, unknown>;

  if (typeof currentPassword !== "string" || !currentPassword) {
    return NextResponse.json({ error: "現在のパスワードを入力してください" }, { status: 400 });
  }
  if (typeof newPassword !== "string" || newPassword.length < 8) {
    return NextResponse.json({ error: "新しいパスワードは8文字以上で入力してください" }, { status: 400 });
  }

  const passwordOk = await verifyPassword(currentPassword, operator.passwordHash);
  if (!passwordOk) {
    return NextResponse.json({ error: "現在のパスワードが正しくありません" }, { status: 401 });
  }

  const newPasswordHash = await hashPassword(newPassword);
  await prisma.operator.update({ where: { id: operator.id }, data: { passwordHash: newPasswordHash } });

  await recordAuditLog({
    operatorId: operator.id,
    action: "ops_change_password",
    targetType: "Operator",
    targetId: operator.id,
  }).catch((error) => {
    console.error("[POST /api/ops/auth/change-password] audit log recording failed:", error);
  });

  return NextResponse.json({ ok: true }, { status: 200 });
}
