import type { Prisma } from "@prisma/client";
import { prisma } from "./prismaClient";
import { isIntegrationEventType, assertNoForbiddenPayloadKeys, type IntegrationEventType } from "@/domain/integration/events";
import { syncIntegrationEvent, MAX_RETRY_COUNT } from "@/server/services/salesforceSync";

export class IntegrationEventRepositoryError extends Error {}

/**
 * Salesforce同期イベントをDBへ積み、直後に1回だけ同期を試行する(専用キュー基盤が無いため。
 * plan.mdの方式)。失敗してもpendingのまま残り、後続の再試行ジョブが処理する。
 * enqueue自体は呼び出し元のメイン処理(診断・登録・認証)を絶対にブロックしない。
 */
export async function enqueueIntegrationEvent(input: {
  eventType: string;
  clinicId?: string | null;
  contactId?: string | null;
  payload: Record<string, unknown>;
}): Promise<void> {
  if (!isIntegrationEventType(input.eventType)) {
    throw new IntegrationEventRepositoryError(`Unknown integration event type: ${input.eventType}`);
  }
  assertNoForbiddenPayloadKeys(input.payload);

  const event = await prisma.integrationEvent.create({
    data: {
      eventType: input.eventType,
      clinicId: input.clinicId ?? null,
      contactId: input.contactId ?? null,
      payloadJson: JSON.stringify(input.payload),
      status: "pending",
    },
  });

  // enqueue呼び出し元(signup/diagnosis/webhook等)をSalesforce障害で失敗させないよう、
  // 同期試行の例外はここで握りつぶし、pendingのままDBに残す(再試行ジョブが処理)。
  await syncIntegrationEvent(event.id).catch((error) => {
    console.error(`[integrationEventRepository] initial sync attempt failed for ${event.id}:`, error);
  });
}

export async function findPendingIntegrationEvents(limit: number) {
  return prisma.integrationEvent.findMany({
    where: { status: { in: ["pending", "failed"] } },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
}

export async function markIntegrationEventSynced(id: string, externalId: string): Promise<void> {
  await prisma.integrationEvent.update({
    where: { id },
    data: { status: "synced", externalId, processedAt: new Date() },
  });
}

export async function markIntegrationEventFailed(id: string, error: string): Promise<void> {
  await prisma.integrationEvent.update({
    where: { id },
    data: {
      status: "failed",
      lastError: error.slice(0, 500),
      retryCount: { increment: 1 },
    },
  });
}

// --- ops再送管理画面向け(2026-09-24) ---
// Salesforceのオブジェクト構成・項目マッピング・immedio連携には一切踏み込まず、
// 既存のIntegrationEventキュー自体の確認・安全な再送のみを対象とする。

export interface IntegrationEventOpsFilter {
  status?: string;
  eventType?: string;
  clinicId?: string;
  retryExhaustedOnly?: boolean;
  createdFrom?: Date;
  createdTo?: Date;
}

function buildIntegrationEventOpsWhere(filter: IntegrationEventOpsFilter): Prisma.IntegrationEventWhereInput {
  const where: Prisma.IntegrationEventWhereInput = {};
  if (filter.status) where.status = filter.status;
  if (filter.eventType) where.eventType = filter.eventType;
  if (filter.clinicId) where.clinicId = filter.clinicId;
  if (filter.retryExhaustedOnly) where.retryCount = { gte: MAX_RETRY_COUNT };
  if (filter.createdFrom || filter.createdTo) {
    where.createdAt = {
      ...(filter.createdFrom ? { gte: filter.createdFrom } : {}),
      ...(filter.createdTo ? { lte: filter.createdTo } : {}),
    };
  }
  return where;
}

const OPS_LIST_PAGE_SIZE = 50;
// 一括再送1回あたりの上限(無条件の全件更新を避けるための安全弁)。
export const OPS_BULK_REENQUEUE_LIMIT = 100;

export async function listIntegrationEventsForOps(
  filter: IntegrationEventOpsFilter,
  page: number
): Promise<{
  items: Awaited<ReturnType<typeof prisma.integrationEvent.findMany>>;
  total: number;
  page: number;
  pageSize: number;
}> {
  const where = buildIntegrationEventOpsWhere(filter);
  const safePage = Math.max(1, Math.floor(page));
  const [items, total] = await Promise.all([
    prisma.integrationEvent.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (safePage - 1) * OPS_LIST_PAGE_SIZE,
      take: OPS_LIST_PAGE_SIZE,
    }),
    prisma.integrationEvent.count({ where }),
  ]);
  return { items, total, page: safePage, pageSize: OPS_LIST_PAGE_SIZE };
}

export async function countIntegrationEventsForOps(filter: IntegrationEventOpsFilter): Promise<number> {
  return prisma.integrationEvent.count({ where: buildIntegrationEventOpsWhere(filter) });
}

export async function getIntegrationEventByIdForOps(id: string) {
  return prisma.integrationEvent.findUnique({ where: { id } });
}

export type IntegrationEventReenqueueResult = "reenqueued" | "not_failed_or_not_found";

/**
 * failed状態の1件だけを、原因解消後の手動再投入としてpendingへ戻す。
 * where句にstatus:"failed"を含めることで、synced/pendingへの誤操作や、
 * 同一イベントへの多重クリックによる二重更新を原子的に防ぐ(1回のみ適用される)。
 */
export async function reenqueueFailedIntegrationEvent(id: string): Promise<IntegrationEventReenqueueResult> {
  const result = await prisma.integrationEvent.updateMany({
    where: { id, status: "failed" },
    data: { status: "pending", retryCount: 0 },
  });
  return result.count === 1 ? "reenqueued" : "not_failed_or_not_found";
}

/**
 * 条件に一致するfailedイベントを上限件数まで一括でpendingへ戻す。
 * 対象は事前に確定したID一覧に対してのみ更新するため、呼び出し時点より後に
 * 新しく条件へ合致したイベントを巻き込まない(対象を明示した安全な再送)。
 */
export async function reenqueueFailedIntegrationEventsBulk(
  filter: IntegrationEventOpsFilter,
  limit: number = OPS_BULK_REENQUEUE_LIMIT
): Promise<{ matchedIds: string[]; reenqueuedCount: number }> {
  const cappedLimit = Math.min(limit, OPS_BULK_REENQUEUE_LIMIT);
  const candidates = await prisma.integrationEvent.findMany({
    where: { ...buildIntegrationEventOpsWhere(filter), status: "failed" },
    orderBy: { createdAt: "asc" },
    take: cappedLimit,
    select: { id: true },
  });
  const matchedIds = candidates.map((c) => c.id);
  if (matchedIds.length === 0) return { matchedIds: [], reenqueuedCount: 0 };

  const updated = await prisma.integrationEvent.updateMany({
    where: { id: { in: matchedIds }, status: "failed" },
    data: { status: "pending", retryCount: 0 },
  });
  return { matchedIds, reenqueuedCount: updated.count };
}

export type { IntegrationEventType };
