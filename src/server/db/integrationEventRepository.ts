import { prisma } from "./prismaClient";
import { isIntegrationEventType, assertNoForbiddenPayloadKeys, type IntegrationEventType } from "@/domain/integration/events";
import { syncIntegrationEvent } from "@/server/services/salesforceSync";

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

export type { IntegrationEventType };
