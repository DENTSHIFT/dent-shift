import "server-only";
import { prisma } from "@/server/db/prismaClient";
import { resolveSalesforceConfigFromProcessEnv } from "@/server/config/salesforceConfig";
import { upsertSalesforceLeadByEmail, type SalesforceLeadFields } from "@/server/providers/salesforce/salesforceClient";

export const MAX_RETRY_COUNT = 8;

function toLeadFields(eventType: string, payload: Record<string, unknown>): SalesforceLeadFields | null {
  const email = payload.email;
  if (typeof email !== "string" || !email) return null;
  return {
    email,
    clinic_name: typeof payload.clinic_name === "string" ? payload.clinic_name : null,
    website_url: typeof payload.website_url === "string" ? payload.website_url : null,
    phone: typeof payload.phone === "string" ? payload.phone : null,
    lead_source: "DENT SHIFT 無料AI診断",
    event_type: eventType,
    registration_step: typeof payload.registration_step === "string" ? payload.registration_step : null,
    trial_ends_at: typeof payload.trial_ends_at === "string" ? payload.trial_ends_at : null,
  };
}

/**
 * pending/failed状態の1件を同期する。Salesforce未接続(disabled)時は何もせず終了する
 * (診断・登録処理自体を止めない、指示書18章)。
 */
export async function syncIntegrationEvent(eventId: string): Promise<void> {
  const config = resolveSalesforceConfigFromProcessEnv();
  if (config.provider === "disabled") return;

  const event = await prisma.integrationEvent.findUnique({ where: { id: eventId } });
  if (!event || event.status === "synced") return;

  const payload = JSON.parse(event.payloadJson) as Record<string, unknown>;
  const leadFields = toLeadFields(event.eventType, payload);
  if (!leadFields) {
    // メールアドレスを含まないイベント(例: online_consultation_booked)は現時点では
    // Lead upsertの対象にできないため、同期不要として処理済み扱いにする。
    await prisma.integrationEvent.update({
      where: { id: event.id },
      data: { status: "synced", processedAt: new Date(), lastAttemptedAt: new Date() },
    });
    return;
  }

  try {
    const { salesforceId } = await upsertSalesforceLeadByEmail({ config, fields: leadFields });
    await prisma.integrationEvent.update({
      where: { id: event.id },
      data: { status: "synced", externalId: salesforceId, processedAt: new Date(), lastAttemptedAt: new Date() },
    });
  } catch (error) {
    await prisma.integrationEvent.update({
      where: { id: event.id },
      data: {
        status: "failed",
        lastError: error instanceof Error ? error.message.slice(0, 500) : "unknown error",
        retryCount: { increment: 1 },
        lastAttemptedAt: new Date(),
      },
    });
    throw error;
  }
}

/**
 * pending/failedイベントを一括で再試行する(Vercel Cronからの定期起動用、指数バックオフ)。
 * retryCountが上限を超えたイベントはスキップし、手動対応が必要な状態として残す。
 */
export async function retryPendingIntegrationEvents(limit = 50): Promise<{ attempted: number }> {
  const config = resolveSalesforceConfigFromProcessEnv();
  if (config.provider === "disabled") return { attempted: 0 };

  const events = await prisma.integrationEvent.findMany({
    where: { status: { in: ["pending", "failed"] }, retryCount: { lt: MAX_RETRY_COUNT } },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  let attempted = 0;
  for (const event of events) {
    const backoffMs = Math.min(2 ** event.retryCount * 1000, 1000 * 60 * 30);
    const dueAt = new Date(event.createdAt.getTime() + backoffMs);
    if (dueAt > new Date() && event.retryCount > 0) continue;

    attempted += 1;
    await syncIntegrationEvent(event.id).catch((error) => {
      console.error(`[salesforceSync] retry failed for ${event.id}:`, error);
    });
  }
  return { attempted };
}
