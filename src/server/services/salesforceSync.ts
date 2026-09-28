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
    // 2026-09-29修正(PO指示、Salesforce連携P0): メールアドレス等からLeadを特定できない
    // イベント(例: online_consultation_booked)を、無同期のまま"synced"(処理済み)として
    // 隠さない。「オンライン相談希望を送信し忘れる」事故を防ぐため、理由付きの"failed"に
    // し、運用画面(/ops/integration-events)で必ず目に見える・手動対応できる状態にする。
    // MAX_RETRY_COUNTに達していなくても自動再送では解決しない類のエラー(恒久的に
    // メールアドレスが無い)だが、運用側が手動でpayloadを補完して再送できるよう
    // 通常のfailedと同じ扱いにする(別ステータスは追加せず、lastErrorで区別する)。
    await prisma.integrationEvent.update({
      where: { id: event.id },
      data: {
        status: "failed",
        lastError: "no_matchable_lead_identifier: メールアドレス等からLeadを特定できませんでした(要確認)",
        lastAttemptedAt: new Date(),
        nextRetryAt: null,
        // 自動リトライで解決しない種類の失敗(恒久的にメールアドレスが無い)のため、
        // 自動再送ループの対象からは外す(retryCount上限扱いにする)。運用者による
        // 手動再送(reenqueueFailedIntegrationEvent、上限到達分も対象)は引き続き可能。
        retryCount: MAX_RETRY_COUNT,
      },
    });
    return;
  }

  try {
    const { salesforceId } = await upsertSalesforceLeadByEmail({ config, fields: leadFields });
    await prisma.integrationEvent.update({
      where: { id: event.id },
      data: {
        status: "synced",
        externalId: salesforceId,
        processedAt: new Date(),
        lastAttemptedAt: new Date(),
        // 2026-09-29追加(PO承認): 同期成功時は次回再送予定を消す。
        nextRetryAt: null,
      },
    });
  } catch (error) {
    const nextRetryCount = event.retryCount + 1;
    await prisma.integrationEvent.update({
      where: { id: event.id },
      data: {
        status: "failed",
        lastError: error instanceof Error ? error.message.slice(0, 500) : "unknown error",
        retryCount: { increment: 1 },
        lastAttemptedAt: new Date(),
        // 2026-09-29追加(PO承認、Salesforce連携P0): 指数バックオフの次回実行予定時刻を
        // 永続化する(従来はその都度計算するだけで保存していなかった)。
        nextRetryAt: computeNextRetryAt(nextRetryCount),
      },
    });
    throw error;
  }
}

/**
 * 指数バックオフの次回実行予定時刻を計算する(2^retryCount秒、上限30分)。
 * 「現在時刻」からの相対値とする(従来のcreatedAt起点の計算から変更。何度も再送に
 * 失敗しているイベントほど、直近の失敗からの間隔で正しく間隔が空くようにするため)。
 */
export function computeNextRetryAt(retryCountAfterThisFailure: number, now: Date = new Date()): Date {
  const backoffMs = Math.min(2 ** retryCountAfterThisFailure * 1000, 1000 * 60 * 30);
  return new Date(now.getTime() + backoffMs);
}

/**
 * pending/failedイベントを一括で再試行する(Vercel Cronからの定期起動用、指数バックオフ)。
 * retryCountが上限を超えたイベントはスキップし、手動対応が必要な状態として残す。
 */
export async function retryPendingIntegrationEvents(limit = 50): Promise<{ attempted: number }> {
  const config = resolveSalesforceConfigFromProcessEnv();
  if (config.provider === "disabled") return { attempted: 0 };

  // 2026-09-29修正(PO承認、Salesforce連携P0): 永続化したnextRetryAtで判定する
  // (従来はcreatedAt起点でその都度計算していた)。nextRetryAtがnull(初回試行分)は
  // 即座に対象にする。
  const now = new Date();
  const events = await prisma.integrationEvent.findMany({
    where: {
      status: { in: ["pending", "failed"] },
      retryCount: { lt: MAX_RETRY_COUNT },
      OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
    },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  let attempted = 0;
  for (const event of events) {
    attempted += 1;
    await syncIntegrationEvent(event.id).catch((error) => {
      console.error(`[salesforceSync] retry failed for ${event.id}:`, error);
    });
  }
  return { attempted };
}
