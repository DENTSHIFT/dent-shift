import type { PlanId } from "@/domain/billing/planCatalog";

/**
 * 制作会社向け修正指示書の月次無料枠(仕様書Ver1 / planCatalog.tsの「指示書」行と一致):
 * ライト=都度課金(0件)、スタンダード=月1件込み、プレミアム=月3件込み。
 */
export const INSTRUCTION_PDF_ENTITLEMENT_KEY = "instruction_pdf_monthly";

export const INSTRUCTION_PDF_MONTHLY_QUOTA: Readonly<Record<PlanId, number>> = {
  light: 0,
  standard: 1,
  premium: 3,
} as const;

/**
 * 無料枠を消費できる契約状態(トライアル・支払い遅延中の猶予・解約予約済みだが
 * 契約終了前は含める。停止・解約済みは含めない)。
 */
const ENTITLED_SUBSCRIPTION_STATUSES = ["trial", "active", "past_due", "cancel_scheduled"] as const;

export function isEntitledSubscriptionStatus(status: string): boolean {
  return (ENTITLED_SUBSCRIPTION_STATUSES as readonly string[]).includes(status);
}

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * JST(Asia/Tokyo, UTC+9固定・夏時間なし)の暦月を"YYYY-MM"で返す。
 * DENT SHIFTは日本国内の歯科医院向けサービスであり、無料枠は「毎月1日0:00 JST〜
 * 末日23:59:59 JST」の暦月で運用するため、デプロイ環境(Vercel=UTC)のタイムゾーンに
 * 依存させず、常にJSTへオフセットしてから年月を取り出す。
 */
export function currentEntitlementPeriod(now: Date = new Date()): string {
  const jst = new Date(now.getTime() + JST_OFFSET_MS);
  const year = jst.getUTCFullYear();
  const month = String(jst.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}
