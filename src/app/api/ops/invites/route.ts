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
  const {
    clinicName,
    email,
    directorName,
    expiresAt,
    maxUses,
    campaign,
    requireEmailMatch,
    isPilot: isPilotInput,
    pilotDurationDays,
    isLifetimeFree: isLifetimeFreeInput,
  } = (body ?? {}) as Record<string, unknown>;

  if (typeof clinicName !== "string" || !clinicName.trim()) {
    return NextResponse.json({ error: "対象医院名は必須です" }, { status: 400 });
  }
  if (typeof email !== "string" || !email.trim()) {
    return NextResponse.json({ error: "対象メールアドレスは必須です" }, { status: 400 });
  }

  // Pilot判定は明示的なisPilotフラグで行う(campaignは流入元・施策区分の記録用に
  // 自由記述できるようにするため、campaign==="pilot"での判定はしない)。
  const isPilot = isPilotInput === true;
  const isLifetimeFree = isLifetimeFreeInput === true;

  // 永久無料はStripeを呼ばないPilot有効化経路を流用するため、Pilot招待でのみ指定できる。
  if (isLifetimeFree && !isPilot) {
    return NextResponse.json(
      { error: "永久無料の特別アカウントはPilot招待としてのみ発行できます" },
      { status: 400 }
    );
  }

  let resolvedPilotDurationDays: number | null = null;
  if (isPilot && !isLifetimeFree) {
    // パイロットは自由入力による設定ミスを防ぐため、日数は正の整数のみ許可する
    // (未指定時は既定28日=4週間。ユーザー方針「3か月固定にせず2〜4週間でフィードバックを
    // 取る」に合わせたデフォルト)。永久無料招待(isLifetimeFree)では期限なしのため
    // pilotDurationDaysは常にnullとし、この検証自体を行わない。
    if (pilotDurationDays !== undefined) {
      if (typeof pilotDurationDays !== "number" || !Number.isInteger(pilotDurationDays) || pilotDurationDays <= 0) {
        return NextResponse.json(
          { error: "パイロット利用日数は正の整数で指定してください" },
          { status: 400 }
        );
      }
      resolvedPilotDurationDays = pilotDurationDays;
    } else {
      resolvedPilotDurationDays = 28;
    }
  }

  // Pilot招待はStripeを一切使用しないため、通常招待用のStripe Price設定
  // (resolveInviteConfigFromProcessEnv())を要求しない。これにより、通常招待用の
  // Stripe設定が本番で未整備でも、Pilot招待の発行はブロックされない。
  let stripePriceId: string;
  if (isPilot) {
    stripePriceId = "pilot-no-stripe";
  } else {
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
    stripePriceId = config.defaultStripePriceId;
  }

  const invite = await createInvite({
    clinicName: clinicName.trim(),
    email: email.trim(),
    directorName: typeof directorName === "string" && directorName.trim() ? directorName.trim() : null,
    stripePriceId,
    expiresAt: typeof expiresAt === "string" && expiresAt ? new Date(expiresAt) : null,
    maxUses: typeof maxUses === "number" && maxUses > 0 ? Math.floor(maxUses) : 1,
    requireEmailMatch: typeof requireEmailMatch === "boolean" ? requireEmailMatch : true,
    campaign: typeof campaign === "string" && campaign.trim() ? campaign.trim() : null,
    isPilot,
    pilotDurationDays: resolvedPilotDurationDays,
    isLifetimeFree,
    createdByOperatorId: operator.id,
  });

  await recordAuditLog({
    operatorId: operator.id,
    action: "ops_create_invite",
    targetType: "Invite",
    targetId: invite.id,
    metadata: {
      clinicName: invite.clinicName,
      email: invite.email,
      campaign: invite.campaign,
      isPilot: invite.isPilot,
      isLifetimeFree: invite.isLifetimeFree,
    },
  }).catch((error) => {
    console.error("[POST /api/ops/invites] audit log recording failed:", error);
  });

  return NextResponse.json({ inviteCode: invite.inviteCode, id: invite.id }, { status: 201 });
}
