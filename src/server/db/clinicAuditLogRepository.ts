import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prismaClient";

/**
 * 医院側(Contact)によるオプション購入・生成・ダウンロード操作の監査ログ。
 * 運営者(Operator)向けのAuditLog(auditLogRepository.ts)とは責務を分離する
 * (2026-09-21のユーザー指示。仕様書Ver1■4「生成/決済/DL/再DLを監査ログへ記録」)。
 * トランザクション内から呼べるよう、Prisma.TransactionClientも受け付ける。
 */
export async function recordClinicAuditLog(
  client: Prisma.TransactionClient | typeof prisma,
  input: {
    clinicId: string;
    contactId?: string | null;
    action: string;
    targetType: string;
    targetId?: string | null;
    metadata?: Record<string, unknown>;
  }
) {
  return client.clinicAuditLog.create({
    data: {
      clinicId: input.clinicId,
      contactId: input.contactId ?? null,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      metadataJson: input.metadata ? JSON.stringify(input.metadata) : null,
    },
  });
}

export async function getClinicAuditLogs(clinicId: string, limit = 50) {
  return prisma.clinicAuditLog.findMany({
    where: { clinicId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
