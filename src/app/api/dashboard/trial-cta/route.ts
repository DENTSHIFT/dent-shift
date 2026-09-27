import { NextRequest, NextResponse } from "next/server";
import { getCurrentContact } from "@/server/auth/session";
import { enqueueIntegrationEvent } from "@/server/db/integrationEventRepository";
import { safeNextPath } from "@/domain/auth/safeNextPath";

// 2026-09-28追加(PO承認、P1-6): ダッシュボード上部CTAのクリックを計測してから遷移する
// 中継ルート。ダッシュボードはサーバーコンポーネントで、既存のTrackedCtaLink(診断結果
// ページ専用、diagnosisIdベース)はここでは使えない(認証済みclinicIdベースで計測したい)ため、
// クライアントJSを増やさずサーバー側だけで完結させる。clinicIdはクライアントから受け取らず
// 必ずセッションから取得する(なりすまし防止)。遷移先はsafeNextPathで検証した同一サイト内
// パスのみ許可する(オープンリダイレクト対策)。クリック自体はブラウザの自己申告であり、
// Stripe Webhook由来のtrial_activated/subscription_activatedとは区別する(PO指示)。
export async function GET(request: NextRequest) {
  const currentContact = await getCurrentContact();
  const to = safeNextPath(request.nextUrl.searchParams.get("to")) ?? "/plans";

  if (currentContact) {
    await enqueueIntegrationEvent({
      eventType: "dashboard_trial_cta_clicked",
      clinicId: currentContact.clinicId,
      contactId: currentContact.id,
      payload: { to },
    }).catch((error) => {
      console.error("[GET /api/dashboard/trial-cta] Salesforce sync enqueue failed:", error);
    });
  }

  return NextResponse.redirect(new URL(to, request.url), 303);
}
