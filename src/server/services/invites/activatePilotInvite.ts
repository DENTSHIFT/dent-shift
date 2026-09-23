import "server-only";
import { getInviteByCode, consumeInviteForClinic } from "@/server/db/inviteRepository";
import {
  validateInvite,
  computeInviteCancelAtEpochSeconds,
  computeInviteCancelAtEpochSecondsByDays,
} from "@/domain/invite/inviteCode";
import { createSubscriptionRecord } from "@/server/db/billingRepository";
import { resolvePilotInviteConfigFromProcessEnv } from "@/server/config/pilotInviteConfig";

export class PilotInviteError extends Error {
  code: "disabled" | "not_found" | "email_mismatch" | "already_used";
  constructor(message: string, code: PilotInviteError["code"]) {
    super(message);
    this.code = code;
  }
}

/**
 * 知人院長向けパイロット先行利用の有効化(test環境限定、Stripeを一切呼ばない)。
 * 通常の1円招待(requestInviteCheckout.ts)とは完全に別経路:
 * - Stripe Checkoutを作成しない、決済を一切発生させない
 * - campaign === "pilot" のInviteのみが対象(通常の1円招待は対象外)
 * - Subscriptionをこの場で直接standard相当・active状態で作成する
 * - 3か月後の終了予定はtrialEndsAtに記録するのみ(Stripe側のcancel_atは存在しない、
 *   実際の自動終了の強制はスコープ外の残課題として運用側で管理する)
 */
export async function activatePilotInvite(input: {
  inviteCode: string;
  clinicId: string;
  contactEmail: string;
}) {
  const config = resolvePilotInviteConfigFromProcessEnv();
  if (config.mode !== "enabled") {
    throw new PilotInviteError("パイロット利用は現在有効ではありません。", "disabled");
  }

  const invite = await getInviteByCode(input.inviteCode);
  if (!invite || invite.campaign !== "pilot") {
    throw new PilotInviteError("この招待は見つかりませんでした。", "not_found");
  }

  const validation = validateInvite({
    status: invite.status,
    startsAt: invite.startsAt,
    expiresAt: invite.expiresAt,
    maxUses: invite.maxUses,
    usedCount: invite.usedCount,
  });
  if (!validation.valid) {
    throw new PilotInviteError("この招待は現在ご利用いただけません。", "not_found");
  }

  if (invite.requireEmailMatch && invite.email.toLowerCase() !== input.contactEmail.toLowerCase()) {
    throw new PilotInviteError(
      "この招待は招待先メールアドレス宛です。招待メールに記載のメールアドレスでログインしてください。",
      "email_mismatch"
    );
  }

  const consumed = await consumeInviteForClinic({ inviteId: invite.id, clinicId: input.clinicId });
  if (!consumed) {
    throw new PilotInviteError("この招待はすでに使用済みです。", "already_used");
  }

  const now = new Date();
  // pilotDurationDaysが設定されていれば日数単位(2〜4週間等の短期試用)を優先し、
  // 未設定の場合のみ従来のdurationMonths(月単位)で計算する。
  const endsAt =
    invite.pilotDurationDays != null
      ? new Date(computeInviteCancelAtEpochSecondsByDays(now, invite.pilotDurationDays) * 1000)
      : new Date(computeInviteCancelAtEpochSeconds(now, invite.durationMonths) * 1000);

  const subscription = await createSubscriptionRecord({
    clinicId: input.clinicId,
    plan: "standard",
    status: "active",
    externalSubscriptionId: `pilot_${invite.id}`,
    inviteId: invite.id,
    trialStartedAt: now,
    trialEndsAt: endsAt,
  });

  return { subscriptionId: subscription.id, startedAt: now, endsAt };
}
