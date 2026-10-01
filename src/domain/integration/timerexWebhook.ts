// TimeRex Webhook(event_confirmed / event_cancelled)の本文を、保存に必要な最小項目へ正規化する。
// ゲストの氏名・コメント・回答フォームの内容は保存しない(対応付けにだけメールアドレスを使う)。

export type TimeRexWebhookType = "event_confirmed" | "event_cancelled";

export interface TimeRexBookingNotice {
  webhookType: TimeRexWebhookType;
  timerexEventId: string;
  startAt: Date;
  endAt: Date;
  bookedAt: Date | null;
  canceledAt: Date | null;
  calendarName: string | null;
  hostName: string | null;
  guestEmail: string | null;
  urlParams: Record<string, string>;
}

export type ParseTimeRexWebhookResult =
  | { ok: true; booking: TimeRexBookingNotice }
  | { ok: false; reason: "unsupported_type" | "invalid_payload" };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// url_paramsは [{ "utm_source": "x" }, { "ds_ref": "y" }] のような1キーずつのオブジェクト配列で届く。
function parseUrlParams(value: unknown): Record<string, string> {
  const params: Record<string, string> = {};
  const entries = Array.isArray(value) ? value : asRecord(value) ? [value] : [];
  for (const entry of entries) {
    const record = asRecord(entry);
    if (!record) continue;
    for (const [key, raw] of Object.entries(record)) {
      if (typeof raw === "string" && !(key in params)) params[key] = raw;
    }
  }
  return params;
}

export function parseTimeRexWebhook(body: unknown): ParseTimeRexWebhookResult {
  const root = asRecord(body);
  if (!root) return { ok: false, reason: "invalid_payload" };
  const webhookType = root.webhook_type;
  if (webhookType !== "event_confirmed" && webhookType !== "event_cancelled") {
    return { ok: false, reason: "unsupported_type" };
  }
  const event = asRecord(root.event);
  const timerexEventId = nonEmptyString(event?.id);
  const startAt = parseDate(event?.start_datetime);
  const endAt = parseDate(event?.end_datetime);
  if (!event || !timerexEventId || !startAt || !endAt) return { ok: false, reason: "invalid_payload" };

  const form = Array.isArray(event.form) ? event.form : [];
  const guestEmailField = form.map(asRecord).find((field) => field?.field_type === "guest_email");
  const hosts = Array.isArray(event.hosts) ? event.hosts.map(asRecord) : [];

  return {
    ok: true,
    booking: {
      webhookType,
      timerexEventId,
      startAt,
      endAt,
      bookedAt: parseDate(event.created_at),
      canceledAt: webhookType === "event_cancelled" ? parseDate(event.canceled_at) : null,
      calendarName: nonEmptyString(root.calendar_name),
      hostName: nonEmptyString(hosts[0]?.name),
      guestEmail: nonEmptyString(guestEmailField?.value),
      urlParams: parseUrlParams(event.url_params),
    },
  };
}
