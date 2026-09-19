import { NextRequest, NextResponse } from "next/server";
import { retryPendingIntegrationEvents } from "@/server/services/salesforceSync";

/**
 * Vercel Cronから定期起動される、Salesforce同期失敗イベントの再試行エンドポイント。
 * Vercel Cronからのリクエストには`Authorization: Bearer ${CRON_SECRET}`が自動付与される
 * (https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs)。
 * CRON_SECRETが未設定の環境(ローカル等)では認証チェック自体をスキップする。
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const result = await retryPendingIntegrationEvents();
  return NextResponse.json(result, { status: 200 });
}
