import "server-only";
import type { Prisma } from "@prisma/client";

/**
 * 無料枠の判定+消費を1回のupdateManyで原子的に行う(同時リクエストでの
 * 二重消費を防ぐ。仕様書Ver1■「無料枠の判定・消費はDBトランザクション内」)。
 * 呼び出し側は必ずprisma.$transaction内のtxを渡すこと。
 *
 * upsertでusageレコードを用意した上で、usedQuantity < includedQuantityの場合のみ
 * incrementするupdateManyを行い、更新できた行数(0 or 1)で消費成否を判定する。
 * SQLite/PostgresどちらもUPDATE文自体が行ロックを取るため、同一トランザクション分離
 * レベル内で複数リクエストが同時に来ても片方しか消費に成功しない。
 */
export async function tryConsumeEntitlement(
  tx: Prisma.TransactionClient,
  input: {
    clinicId: string;
    entitlementKey: string;
    period: string;
    includedQuantity: number;
  }
): Promise<boolean> {
  if (input.includedQuantity <= 0) return false;

  const usage = await tx.planEntitlementUsage.upsert({
    where: {
      clinicId_entitlementKey_period: {
        clinicId: input.clinicId,
        entitlementKey: input.entitlementKey,
        period: input.period,
      },
    },
    create: {
      clinicId: input.clinicId,
      entitlementKey: input.entitlementKey,
      period: input.period,
      includedQuantity: input.includedQuantity,
      usedQuantity: 0,
    },
    update: {},
  });

  const result = await tx.planEntitlementUsage.updateMany({
    where: { id: usage.id, usedQuantity: { lt: usage.includedQuantity } },
    data: { usedQuantity: { increment: 1 } },
  });
  return result.count === 1;
}

export async function getEntitlementUsage(input: {
  clinicId: string;
  entitlementKey: string;
  period: string;
}) {
  const { prisma } = await import("./prismaClient");
  return prisma.planEntitlementUsage.findUnique({
    where: {
      clinicId_entitlementKey_period: {
        clinicId: input.clinicId,
        entitlementKey: input.entitlementKey,
        period: input.period,
      },
    },
  });
}
