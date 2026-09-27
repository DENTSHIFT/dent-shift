import { NextRequest, NextResponse } from "next/server";
import { getCurrentContact } from "@/server/auth/session";
import { enqueueIntegrationEvent } from "@/server/db/integrationEventRepository";
import { safeNextPath } from "@/domain/auth/safeNextPath";

// 2026-09-28追加(PO承認、P1-6)、2026-09-28修正(PO再指摘): ダッシュボード上部CTAのクリックを
// 計測してから遷移する。**GETではなくPOSTのみ受け付ける**(GETの副作用化はNext.jsの
// prefetch・ブラウザの先読み・クローラー等により、実際にクリックしていないのに
// イベントが記録されうるため、PO再指摘により禁止)。フォーム送信(ユーザーの明示的な
// 操作)でのみこのルートに到達する。
// CSRF対策は既存アプリの方針(billing/checkout/route.ts参照)に合わせ、同一サイトの
// origin一致を確認する(認証Cookie+POSTだけに頼らず、任意の外部サイトからのクリック
// イベント大量生成を防ぐ)。clinicIdはクライアントから受け取らず必ずセッションから取得する
// (なりすまし防止)。遷移先はsafeNextPathで検証した同一サイト内パスのみ許可する
// (オープンリダイレクト対策)。クリック自体はブラウザの自己申告であり、Stripe Webhook
// 由来のtrial_activated/subscription_activatedとは区別する(PO指示)。
export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403 });
  }

  const currentContact = await getCurrentContact();
  if (!currentContact) {
    return NextResponse.redirect(new URL("/login", request.url), 303);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.redirect(new URL("/plans", request.url), 303);
  }
  const to = safeNextPath(formData.get("to")?.toString()) ?? "/plans";

  await enqueueIntegrationEvent({
    eventType: "dashboard_trial_cta_clicked",
    clinicId: currentContact.clinicId,
    contactId: currentContact.id,
    payload: { to },
  }).catch((error) => {
    console.error("[POST /api/dashboard/trial-cta] Salesforce sync enqueue failed:", error);
  });

  return NextResponse.redirect(new URL(to, request.url), 303);
}
