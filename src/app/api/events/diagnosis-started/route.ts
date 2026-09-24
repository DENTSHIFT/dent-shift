import { NextRequest, NextResponse } from "next/server";
import { enqueueIntegrationEvent } from "@/server/db/integrationEventRepository";
import { sanitizeUtmAttribution } from "@/domain/marketing/utmAttribution";

/**
 * 診断フォーム入力開始(2026-09-24修正: ページ到達ではなく、実際にフォームへ
 * 入力し始めた最初の操作でのみ呼ばれる。呼び出し元はsrc/app/diagnosis/page.tsx)を
 * 記録する公開エンドポイント。まだclinicId/diagnosisIdが存在しない段階のため、
 * UTM流入元(5項目)のみを匿名で記録する。diagnosis_completed(既存)と突き合わせることで、
 * Instagram等の流入チャネル別に「開始→完了」の転換をIntegrationEvent上で比較できる
 * (Salesforce連携が無効の間は、Salesforce側での比較はできない)。
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "リクエストボディがJSONとして解釈できません" }, { status: 400 });
  }
  const record = (body ?? {}) as Record<string, unknown>;

  await enqueueIntegrationEvent({
    eventType: "diagnosis_started",
    clinicId: null,
    payload: sanitizeUtmAttribution(record),
  }).catch((error) => {
    console.error("[POST /api/events/diagnosis-started] Salesforce sync enqueue failed:", error);
  });

  return new NextResponse(null, { status: 204 });
}
