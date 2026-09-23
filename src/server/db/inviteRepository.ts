import "server-only";
import { prisma } from "./prismaClient";
import type { Prisma } from "@prisma/client";
import { generateInviteCode } from "@/domain/invite/inviteCode";

export class InviteRepositoryError extends Error {}

export async function createInvite(input: {
  clinicName: string;
  email: string;
  stripePriceId: string;
  specialPriceJpy?: number;
  durationMonths?: number;
  expiresAt?: Date | null;
  maxUses?: number;
  requireEmailMatch?: boolean;
  campaign?: string | null;
  isPilot?: boolean;
  pilotDurationDays?: number | null;
  isLifetimeFree?: boolean;
  createdByOperatorId?: string | null;
}) {
  // 招待コードのunique制約に稀に衝突した場合のみ再生成する(実質発生しない想定)。
  for (let attempt = 0; attempt < 5; attempt++) {
    const inviteCode = generateInviteCode();
    try {
      return await prisma.invite.create({
        data: {
          inviteCode,
          clinicName: input.clinicName,
          email: input.email,
          stripePriceId: input.stripePriceId,
          specialPriceJpy: input.specialPriceJpy ?? 1,
          durationMonths: input.durationMonths ?? 3,
          expiresAt: input.expiresAt ?? null,
          maxUses: input.maxUses ?? 1,
          requireEmailMatch: input.requireEmailMatch ?? true,
          campaign: input.campaign ?? null,
          isPilot: input.isPilot ?? false,
          pilotDurationDays: input.pilotDurationDays ?? null,
          isLifetimeFree: input.isLifetimeFree ?? false,
          createdByOperatorId: input.createdByOperatorId ?? null,
        },
      });
    } catch (error) {
      const isUniqueViolation =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: string }).code === "P2002";
      if (!isUniqueViolation) throw error;
    }
  }
  throw new InviteRepositoryError("Failed to generate a unique invite code after 5 attempts.");
}

export async function getInviteByCode(inviteCode: string) {
  return prisma.invite.findUnique({ where: { inviteCode } });
}

export async function getInviteById(id: string) {
  return prisma.invite.findUnique({ where: { id } });
}

/**
 * Webhook側(checkout.session.completed)から呼ぶ。決済成功が確認できた時点で
 * 初めて招待を消費する(Checkout作成時点では消費しない。仕様書■「1回限定の場合は
 * 使用後に無効化」を実際の支払い完了と一致させるため)。
 * 利用者(Contact)はclinicId単位で1件だけ想定(owner優先)。
 */
export async function consumeInviteForClinic(input: { inviteId: string; clinicId: string }) {
  return prisma.$transaction(async (tx) => {
    const contact =
      (await tx.contact.findFirst({ where: { clinicId: input.clinicId, role: "owner" } })) ??
      (await tx.contact.findFirst({ where: { clinicId: input.clinicId } }));
    if (!contact) return false;
    return tryConsumeInvite(tx, { inviteId: input.inviteId, contactId: contact.id });
  });
}

export async function listInvites() {
  return prisma.invite.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      // パイロットモニタリング一覧(/ops/invites)用。使用済みでなければ全てnull。
      usedByContact: {
        include: {
          clinic: {
            include: {
              // 最新の診断1件だけで十分(「診断実行済みか」「スコア」の表示用)。
              diagnoses: { orderBy: { measuredAt: "desc" }, take: 1 },
            },
          },
        },
      },
      subscriptions: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
}

/**
 * 招待の使用を原子的に消費する(同時アクセスでの二重消費防止。
 * PlanEntitlementUsageのtryConsumeEntitlement()と同じ「条件付きUPDATEの行数」パターン)。
 * usedCount < maxUses の場合のみ+1し、maxUsesへ到達したらstatusを"used"にする。
 */
export async function tryConsumeInvite(
  tx: Prisma.TransactionClient,
  input: { inviteId: string; contactId: string }
): Promise<boolean> {
  const invite = await tx.invite.findUnique({ where: { id: input.inviteId } });
  if (!invite) return false;

  const result = await tx.invite.updateMany({
    where: { id: input.inviteId, usedCount: { lt: invite.maxUses }, status: "active" },
    data: {
      usedCount: { increment: 1 },
      usedAt: new Date(),
      usedByContactId: input.contactId,
    },
  });
  if (result.count !== 1) return false;

  const updated = await tx.invite.findUniqueOrThrow({ where: { id: input.inviteId } });
  if (updated.usedCount >= updated.maxUses) {
    await tx.invite.update({ where: { id: input.inviteId }, data: { status: "used" } });
  }
  return true;
}
