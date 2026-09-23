import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db/prismaClient";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { hashOperatorPasswordResetToken } from "@/server/auth/operatorPasswordResetToken";
import { validateOperatorPassword, OPERATOR_PASSWORD_REQUIREMENTS_MESSAGE } from "@/domain/auth/operatorPassword";
import { recordAuditLog } from "@/server/db/auditLogRepository";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "リクエストボディがJSONとして解釈できません" }, { status: 400 });
  }
  const { token, newPassword } = (body ?? {}) as Record<string, unknown>;

  if (typeof token !== "string" || !token) {
    return NextResponse.json({ error: "このリンクは無効です。もう一度パスワード再設定をお試しください。" }, { status: 400 });
  }
  if (typeof newPassword !== "string") {
    return NextResponse.json({ error: OPERATOR_PASSWORD_REQUIREMENTS_MESSAGE }, { status: 400 });
  }

  const tokenHash = hashOperatorPasswordResetToken(token);
  const operator = await prisma.operator.findFirst({ where: { passwordResetTokenHash: tokenHash } });

  // トークン不一致・期限切れ・使用済み(=passwordResetTokenHashが既にnull)を同じ
  // エラーメッセージに畳み、有効なトークンの存在を推測させない。
  const invalidTokenResponse = () =>
    NextResponse.json(
      { error: "このリンクは無効か、有効期限が切れています。もう一度パスワード再設定をお試しください。" },
      { status: 400 }
    );

  if (!operator || !operator.passwordResetExpiresAt) {
    return invalidTokenResponse();
  }
  if (operator.passwordResetExpiresAt.getTime() < Date.now()) {
    return invalidTokenResponse();
  }

  const sameAsCurrent = await verifyPassword(newPassword, operator.passwordHash);
  const validation = validateOperatorPassword(newPassword);
  if (!validation.valid) {
    return NextResponse.json({ error: validation.reason }, { status: 400 });
  }
  if (sameAsCurrent) {
    return NextResponse.json(
      { error: "現在のパスワードと異なるパスワードを設定してください" },
      { status: 400 }
    );
  }

  const newPasswordHash = await hashPassword(newPassword);

  await prisma.$transaction([
    prisma.operator.update({
      where: { id: operator.id },
      data: {
        passwordHash: newPasswordHash,
        // 使用済みトークンの再利用を防ぐため即時無効化する。
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null,
      },
    }),
    // パスワード再設定は侵害対応の意味合いを持つため、既存の全セッションを無効化する。
    prisma.operatorSession.deleteMany({ where: { operatorId: operator.id } }),
  ]);

  await recordAuditLog({
    operatorId: operator.id,
    action: "ops_reset_password",
    targetType: "Operator",
    targetId: operator.id,
  }).catch((error) => {
    console.error("[POST /api/ops/auth/reset-password] audit log recording failed:", error);
  });

  return NextResponse.json({ ok: true }, { status: 200 });
}
