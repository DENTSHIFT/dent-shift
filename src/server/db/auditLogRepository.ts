import { prisma } from "./prismaClient";

/**
 * クロステナント参照・外部書き込みを伴う運営側操作を記録する(SECURITY.md F章
 * 「外部書き込みの人承認ゲート」、P0_ACCEPTANCE.md「権限・監査」)。
 * metadataは構造化データをJSON文字列として保存する(SQLite制約、他モデルと同じパターン)。
 */
export async function recordAuditLog(input: {
  operatorId: string;
  action: string;
  targetType: string;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await prisma.auditLog.create({
    data: {
      operatorId: input.operatorId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      metadataJson: input.metadata ? JSON.stringify(input.metadata) : null,
    },
  });
}
