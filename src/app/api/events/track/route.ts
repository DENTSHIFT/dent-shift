import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db/prismaClient";
import { enqueueIntegrationEvent } from "@/server/db/integrationEventRepository";
import { isIntegrationEventType } from "@/domain/integration/events";

// 診断結果画面(未ログイン・会員登録前)からのCTAクリックを記録する公開エンドポイント
// (指示書3章「CTAクリックを内部イベントとして保存し、Salesforceへ非同期同期する」)。
// 認証を要求しないため、受け付けるイベント種別をここで明示的に絞る。
const ALLOWED_PUBLIC_EVENT_TYPES = new Set([
  "diagnosis_result_viewed",
  "online_consultation_clicked",
  "phone_inquiry_clicked",
  // 2026-09-27追加(PO承認、第1段階): 診断結果画面の主CTA(無料トライアルを始める)から
  // /plansへ進んだことの計測(既存基盤のみ使用)。
  "diagnosis_result_trial_cta_clicked",
]);

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "リクエストボディがJSONとして解釈できません" }, { status: 400 });
  }

  const { eventType, diagnosisId } = (body ?? {}) as Record<string, unknown>;
  if (
    typeof eventType !== "string" ||
    !isIntegrationEventType(eventType) ||
    !ALLOWED_PUBLIC_EVENT_TYPES.has(eventType)
  ) {
    return NextResponse.json({ error: "eventTypeが不正です" }, { status: 400 });
  }
  if (typeof diagnosisId !== "string" || !diagnosisId) {
    return NextResponse.json({ error: "diagnosisIdは必須です" }, { status: 400 });
  }

  const diagnosis = await prisma.diagnosis.findUnique({
    where: { id: diagnosisId },
    include: { clinic: true },
  });
  if (!diagnosis) {
    // 存在しないdiagnosisIdでも計測用エンドポイントを不正探索の手がかりにしないため、
    // 詳細を返さず204で静かに無視する。
    return new NextResponse(null, { status: 204 });
  }

  await enqueueIntegrationEvent({
    eventType,
    clinicId: diagnosis.clinicId,
    payload: {
      email: diagnosis.clinic.contactEmail ?? "",
      clinic_name: diagnosis.clinic.name,
      director_name: diagnosis.clinic.directorName,
      website_url: diagnosis.clinic.url,
      // 2026-09-29追加(PO承認、Salesforce連携P0): 相談希望の意思表示イベントである旨を
      // 明示する(online_consultation_clicked/phone_inquiry_clickedのいずれも該当)。
      consultation_requested: true,
      utm_source: diagnosis.clinic.utmSource,
      utm_medium: diagnosis.clinic.utmMedium,
      utm_campaign: diagnosis.clinic.utmCampaign,
      utm_content: diagnosis.clinic.utmContent,
      utm_term: diagnosis.clinic.utmTerm,
    },
  }).catch((error) => {
    console.error("[POST /api/events/track] Salesforce sync enqueue failed:", error);
  });

  return new NextResponse(null, { status: 204 });
}
