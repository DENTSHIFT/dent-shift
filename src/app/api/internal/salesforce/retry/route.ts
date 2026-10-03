import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { retryPendingIntegrationEvents } from "@/server/services/salesforceSync";

function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

/**
 * Vercel Cronから定期起動される、Salesforce同期失敗イベントの再試行エンドポイント。
 * Vercel Cronからのリクエストには`Authorization: Bearer ${CRON_SECRET}`が自動付与される
 * (https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs)。
 * Vercel上(Preview/Production)ではCRON_SECRET未設定なら拒否する(誰でも起動できる状態を防ぐ)。
 * 認証チェックを省略できるのはローカル開発のみ。
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    if (process.env.VERCEL) {
      console.error("[GET /api/internal/salesforce/retry] CRON_SECRET is not configured; refusing to run.");
      return NextResponse.json({ error: "cron_secret_not_configured" }, { status: 503 });
    }
  } else {
    const providedAuthorization = request.headers.get("authorization");
    const expectedAuthorization = `Bearer ${cronSecret}`;
    if (!providedAuthorization || !timingSafeEqualStrings(providedAuthorization, expectedAuthorization)) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const result = await retryPendingIntegrationEvents();
  return NextResponse.json(result, { status: 200 });
}
