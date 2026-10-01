import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

// TimeRexの予約URLへ付与する医院参照パラメータ名。TimeRexは予約ページURLのクエリを
// Webhookのevent.url_paramsとしてそのまま返すため、予約と医院をメールアドレスに頼らず対応付けられる。
export const BOOKING_REF_PARAM = "ds_ref";

function signature(clinicId: string, secret: string): string {
  return createHmac("sha256", secret).update(`booking-ref:${clinicId}`).digest("base64url").slice(0, 22);
}

function resolveSecret(env: Record<string, string | undefined>): string | null {
  return env.TIMEREX_BOOKING_REF_SECRET?.trim() || null;
}

/** 医院IDに改ざん検知用の署名を付けた参照値(`<医院ID>.<署名>`)。秘密鍵が未設定ならnull。 */
export function createBookingRef(clinicId: string, env: Record<string, string | undefined> = process.env): string | null {
  const secret = resolveSecret(env);
  return secret ? `${clinicId}.${signature(clinicId, secret)}` : null;
}

/** 参照値を検証し、正しければ医院IDを返す(署名不一致・形式不正はnull)。 */
export function verifyBookingRef(ref: string, env: Record<string, string | undefined> = process.env): string | null {
  const secret = resolveSecret(env);
  if (!secret) return null;
  const separator = ref.lastIndexOf(".");
  if (separator <= 0) return null;
  const clinicId = ref.slice(0, separator);
  const provided = Buffer.from(ref.slice(separator + 1));
  const expected = Buffer.from(signature(clinicId, secret));
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
  return clinicId;
}

/** 予約URLへ医院参照を付与する(秘密鍵未設定・URL不正時は元のURLのまま)。 */
export function withBookingRef(
  bookingUrl: string,
  clinicId: string | null | undefined,
  env: Record<string, string | undefined> = process.env
): string {
  if (!clinicId) return bookingUrl;
  const ref = createBookingRef(clinicId, env);
  if (!ref) return bookingUrl;
  try {
    const url = new URL(bookingUrl);
    url.searchParams.set(BOOKING_REF_PARAM, ref);
    return url.toString();
  } catch {
    return bookingUrl;
  }
}
