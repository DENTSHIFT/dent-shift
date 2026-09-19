import { prisma } from "./prismaClient";
import { canTransitionAttribution, isAttributionStatus } from "@/domain/ambassador/attributionStatus";
import type { Prisma } from "@prisma/client";

export class AmbassadorRepositoryError extends Error {}

export async function findAmbassadorByReferralCode(referralCode: string) {
  return prisma.ambassador.findUnique({ where: { referralCode } });
}

/**
 * 紹介コード経由の新規医院登録をpending状態で記録する(まだ成果化しない)。
 * 1医院につき1件のみ(Attribution.clinicId unique)。既に記録済みなら何もしない
 * (同一medicalクリニックを二重紹介として扱わない)。
 */
export async function recordPendingAttribution(input: {
  ambassadorId: string;
  clinicId: string;
}): Promise<void> {
  const existing = await prisma.attribution.findUnique({ where: { clinicId: input.clinicId } });
  if (existing) return;
  await prisma.attribution.create({
    data: { ambassadorId: input.ambassadorId, clinicId: input.clinicId, status: "pending" },
  });
}

/**
 * 有料契約+初回入金確定時点でのみ成果化する(指示書外・ユーザー指示による仮仕様)。
 * Stripe Webhook適用と同じtransaction内で呼び出す想定(billingRepository.ts参照)。
 */
export async function confirmAttributionForClinic(
  tx: Prisma.TransactionClient,
  clinicId: string
): Promise<void> {
  const attribution = await tx.attribution.findUnique({ where: { clinicId } });
  if (!attribution) return;
  if (!isAttributionStatus(attribution.status)) {
    throw new AmbassadorRepositoryError("Stored attribution status is invalid.");
  }
  // 既にconfirmed済みなら何もしない(confirmedAtを再入金のたびに上書きしない)。
  if (attribution.status === "confirmed") return;
  if (!canTransitionAttribution(attribution.status, "confirmed")) return;

  await tx.attribution.update({
    where: { id: attribution.id },
    data: { status: "confirmed", confirmedAt: new Date() },
  });
}
