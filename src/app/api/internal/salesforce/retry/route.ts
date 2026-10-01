import { NextRequest, NextResponse } from "next/server";
import { retryPendingIntegrationEvents } from "@/server/services/salesforceSync";

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
  } else if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await retryPendingIntegrationEvents();
  return NextResponse.json(result, { status: 200 });
}
