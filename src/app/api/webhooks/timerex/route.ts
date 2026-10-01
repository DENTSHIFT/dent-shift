import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { resolveTimeRexWebhookConfigFromProcessEnv } from "@/server/config/timerexWebhookConfig";
import { parseTimeRexWebhook } from "@/domain/integration/timerexWebhook";
import { applyTimeRexBooking } from "@/server/services/timerexBookings";

/**
 * TimeRexの予約通知Webhook(公式仕様: https://developers.timerex.net/ja/webhook/reference)。
 * - 通知種別はevent_confirmed(予約成立)とevent_cancelled(キャンセル)の2種類のみ。
 *   TimeRexは「相談実施」を通知しないため、実施有無はSalesforce側で担当者が記録する。
 * - 認証はTimeRexが発行するセキュリティトークン(ヘッダーx-timerex-authorization)の一致確認。
 * - 予約はTimeRexの予約ID(event.id)単位で1件として保存し、同じ通知の再送(TimeRexは失敗時に
 *   10秒間隔で最大2回再送する)や順序の入れ替わりで重複・巻き戻りしない。
 * TIMEREX_WEBHOOK_SECRET未設定の場合はエンドポイント自体を無効化する。
 */
function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

export async function POST(request: NextRequest) {
  const config = resolveTimeRexWebhookConfigFromProcessEnv();
  if (config.provider === "disabled") {
    return NextResponse.json({ error: "予約Webhookは現在無効です" }, { status: 503 });
  }

  const providedToken = request.headers.get("x-timerex-authorization");
  if (!providedToken || !timingSafeEqualStrings(providedToken, config.sharedSecret)) {
    return NextResponse.json({ error: "認証に失敗しました" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "リクエストボディがJSONとして解釈できません" }, { status: 400 });
  }

  const parsed = parseTimeRexWebhook(body);
  if (!parsed.ok) {
    // 未対応の通知種別は再送させない(200)。必須項目の欠落は内容の不備として400を返す。
    if (parsed.reason === "unsupported_type") {
      return NextResponse.json({ status: "ignored" }, { status: 200 });
    }
    return NextResponse.json({ error: "予約通知の形式が不正です" }, { status: 400 });
  }

  // DB保存に失敗した場合は500を返し、TimeRex側の再送に任せる。
  const result = await applyTimeRexBooking(parsed.booking);
  return NextResponse.json({ status: result.outcome, matched: result.matchMethod !== "unmatched" }, { status: 200 });
}
