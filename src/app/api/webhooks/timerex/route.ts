import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/server/db/prismaClient";
import { resolveTimeRexWebhookConfigFromProcessEnv } from "@/server/config/timerexWebhookConfig";
import { enqueueIntegrationEvent } from "@/server/db/integrationEventRepository";
import type { IntegrationEventType } from "@/domain/integration/events";

/**
 * TimeRexからの予約状態通知を受け取るWebhook接続ポイント(指示書12章)。
 *
 * 重要: TimeRex側の実際の署名検証方式・ヘッダー名・payload形式は契約/実装確認前で
 * 未確定(指示書23章「オンライン説明：TimeRex/Immedio等の最終採用サービス」)。
 * ここでは暫定的に共有シークレットを`X-TimeRex-Webhook-Secret`ヘッダーで突き合わせる
 * 仮実装とし、実際の署名方式が判明次第置き換える(STEP6報告事項)。
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

  const providedSecret = request.headers.get("x-timerex-webhook-secret");
  if (!providedSecret || !timingSafeEqualStrings(providedSecret, config.sharedSecret)) {
    return NextResponse.json({ error: "認証に失敗しました" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "リクエストボディがJSONとして解釈できません" }, { status: 400 });
  }

  const { email, status } = (body ?? {}) as Record<string, unknown>;
  if (typeof email !== "string" || !email) {
    return NextResponse.json({ error: "emailは必須です" }, { status: 400 });
  }
  let eventType: IntegrationEventType;
  if (status === "booked") {
    eventType = "online_consultation_booked";
  } else if (status === "completed") {
    eventType = "online_consultation_completed";
  } else {
    return NextResponse.json(
      { error: "statusは'booked'または'completed'を指定してください" },
      { status: 400 }
    );
  }

  // 予約者のメールアドレスから医院(Clinic)を特定する。診断済みでメールを保持している
  // Clinicと突き合わせる(TimeRexは会員登録前のユーザーからも予約されうるため)。
  const clinic = await prisma.clinic.findFirst({ where: { contactEmail: email } });
  if (!clinic) {
    // 突き合わせ不能でもWebhook自体は200を返し、TimeRex側の再送を誘発しない。
    return NextResponse.json({ status: "ignored" }, { status: 200 });
  }

  await enqueueIntegrationEvent({
    eventType,
    clinicId: clinic.id,
    payload: { email, clinic_name: clinic.name, website_url: clinic.url },
  }).catch((error) => {
    console.error("[POST /api/webhooks/timerex] Salesforce sync enqueue failed:", error);
  });

  return NextResponse.json({ status: "accepted" }, { status: 200 });
}
