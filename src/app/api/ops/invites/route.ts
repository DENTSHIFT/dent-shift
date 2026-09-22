import { NextRequest, NextResponse } from "next/server";
import { getCurrentOperator } from "@/server/auth/operatorSession";
import { createInvite } from "@/server/db/inviteRepository";
import { recordAuditLog } from "@/server/db/auditLogRepository";
import {
  resolveInviteConfigFromProcessEnv,
  InviteConfigError,
} from "@/server/config/inviteConfig";

/**
 * 運営側(Operator)専用の招待発行API。通常ユーザーは絶対に到達できない
 * (/ops配下と同じOperatorセッションを要求する)。
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
  const { clinicName, email, expiresAt, maxUses, campaign, requireEmailMatch } =
    (body ?? {}) as Record<string, unknown>;

  if (typeof clinicName !== "string" || !clinicName.trim()) {
    return NextResponse.json({ error: "対象医院名は必須です" }, { status: 400 });
  }
  if (typeof email !== "string" || !email.trim()) {
    return NextResponse.json({ error: "対象メールアドレスは必須です" }, { status: 400 });
  }

  let config;
  try {
    config = resolveInviteConfigFromProcessEnv();
  } catch (error) {
    if (error instanceof InviteConfigError) {
      console.error("[POST /api/ops/invites] invite configuration error");
      return NextResponse.json({ error: "招待発行は現在利用できません。" }, { status: 503 });
    }
    throw error;
  }

  const invite = await createInvite({
    clinicName: clinicName.trim(),
    email: email.trim(),
    stripePriceId: config.defaultStripePriceId,
    expiresAt: typeof expiresAt === "string" && expiresAt ? new Date(expiresAt) : null,
    maxUses: typeof maxUses === "number" && maxUses > 0 ? Math.floor(maxUses) : 1,
    requireEmailMatch: typeof requireEmailMatch === "boolean" ? requireEmailMatch : true,
    campaign: typeof campaign === "string" && campaign.trim() ? campaign.trim() : null,
    createdByOperatorId: operator.id,
  });

  await recordAuditLog({
    operatorId: operator.id,
    action: "ops_create_invite",
    targetType: "Invite",
    targetId: invite.id,
    metadata: { clinicName: invite.clinicName, email: invite.email, campaign: invite.campaign },
  }).catch((error) => {
    console.error("[POST /api/ops/invites] audit log recording failed:", error);
  });

  return NextResponse.json({ inviteCode: invite.inviteCode, id: invite.id }, { status: 201 });
}
