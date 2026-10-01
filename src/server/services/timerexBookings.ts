import "server-only";
import { prisma } from "@/server/db/prismaClient";
import {
  attemptIntegrationEventSync,
  createPendingIntegrationEventInTransaction,
} from "@/server/db/integrationEventRepository";
import { BOOKING_REF_PARAM, verifyBookingRef } from "@/server/integration/bookingRef";
import type { TimeRexBookingNotice } from "@/domain/integration/timerexWebhook";

export type BookingMatchMethod = "signed_ref" | "contact_email" | "unmatched";

interface BookingMatch {
  clinicId: string | null;
  contactId: string | null;
  matchMethod: BookingMatchMethod;
}

async function findContactsByEmail(email: string) {
  const candidates = [...new Set([email, email.toLowerCase()])];
  return prisma.contact.findMany({ where: { email: { in: candidates } }, select: { id: true, clinicId: true } });
}

/**
 * 予約と医院・担当者の対応付け。推測では紐づけない。
 * 1. 予約URLに付与した署名付き医院参照(ds_ref)が正しく、医院が実在する場合 → その医院
 *    (担当者は、予約メールがその医院の会員と一致した場合のみ)
 * 2. 予約メールが会員(Contact)のメールアドレスと一致する1件だけの場合 → その会員の医院
 * 3. それ以外(医院の代表メールとの一致だけ・複数一致など) → 対応付けなし(運用画面で確認)
 */
export async function matchBookingToClinic(notice: TimeRexBookingNotice): Promise<BookingMatch> {
  const contacts = notice.guestEmail ? await findContactsByEmail(notice.guestEmail) : [];
  const ref = notice.urlParams[BOOKING_REF_PARAM];
  const refClinicId = ref ? verifyBookingRef(ref) : null;
  if (refClinicId) {
    const clinic = await prisma.clinic.findUnique({ where: { id: refClinicId }, select: { id: true } });
    if (clinic) {
      const contact = contacts.length === 1 && contacts[0]!.clinicId === clinic.id ? contacts[0]! : null;
      return { clinicId: clinic.id, contactId: contact?.id ?? null, matchMethod: "signed_ref" };
    }
  }
  if (contacts.length === 1) {
    return { clinicId: contacts[0]!.clinicId, contactId: contacts[0]!.id, matchMethod: "contact_email" };
  }
  return { clinicId: null, contactId: null, matchMethod: "unmatched" };
}

export type ApplyBookingOutcome = "recorded" | "ignored_stale";

/**
 * TimeRexの予約通知を、予約ID単位で保存する(同じ通知の再送は同じ1行の更新)。
 * - キャンセルは確定状態として扱い、後から届いた古い予約成立通知で「予約成立」へ戻さない。
 * - キャンセル通知はurl_paramsを含まないため、既に対応付け済みの医院・担当者を引き継ぐ。
 * - 医院が特定できた場合だけ、同じトランザクションでSalesforce送信待ちイベントを記録する
 *   (冪等キー=通知種別+予約ID。TimeRexの再送で重複しない)。
 */
export async function applyTimeRexBooking(
  notice: TimeRexBookingNotice,
  now: Date = new Date()
): Promise<{ outcome: ApplyBookingOutcome; matchMethod: BookingMatchMethod }> {
  const match = await matchBookingToClinic(notice);
  const status = notice.webhookType === "event_cancelled" ? "cancelled" : "confirmed";

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.consultationBooking.findUnique({ where: { timerexEventId: notice.timerexEventId } });
    if (existing && existing.status === "cancelled" && status === "confirmed") {
      return { outcome: "ignored_stale" as const, matchMethod: existing.matchMethod as BookingMatchMethod, eventId: null };
    }
    // 既存の対応付けは、より確実な方法(署名付き参照)で上書きする場合を除き維持する。
    const keepExistingMatch =
      existing && existing.clinicId && (match.matchMethod === "unmatched" || existing.matchMethod === "signed_ref");
    const effective: BookingMatch = keepExistingMatch
      ? {
          clinicId: existing.clinicId,
          contactId: existing.contactId ?? (match.clinicId === existing.clinicId ? match.contactId : null),
          matchMethod: existing.matchMethod as BookingMatchMethod,
        }
      : match;
    const data = {
      status,
      clinicId: effective.clinicId,
      contactId: effective.contactId,
      matchMethod: effective.matchMethod,
      startAt: notice.startAt,
      endAt: notice.endAt,
      bookedAt: notice.bookedAt ?? existing?.bookedAt ?? null,
      canceledAt: status === "cancelled" ? notice.canceledAt ?? now : null,
      calendarName: notice.calendarName,
      hostName: notice.hostName,
      lastWebhookType: notice.webhookType,
      lastWebhookAt: now,
    };
    await tx.consultationBooking.upsert({
      where: { timerexEventId: notice.timerexEventId },
      create: { timerexEventId: notice.timerexEventId, ...data },
      update: data,
    });
    if (!effective.clinicId) return { outcome: "recorded" as const, matchMethod: effective.matchMethod, eventId: null };
    const event = await createPendingIntegrationEventInTransaction(tx, {
      eventType: status === "cancelled" ? "online_consultation_canceled" : "online_consultation_booked",
      clinicId: effective.clinicId,
      contactId: effective.contactId,
      // 予約の詳細はConsultationBookingが正本。イベントには予約IDと対応付け方法だけを残す。
      payload: { timerex_event_id: notice.timerexEventId, match_method: effective.matchMethod },
      dedupeKey: `timerex:${notice.webhookType}:${notice.timerexEventId}`,
    });
    return { outcome: "recorded" as const, matchMethod: effective.matchMethod, eventId: event?.id ?? null };
  });

  if (result.eventId) await attemptIntegrationEventSync(result.eventId);
  return { outcome: result.outcome, matchMethod: result.matchMethod };
}
