import "server-only";
import { NextResponse } from "next/server";
import { getCurrentOperator } from "@/server/auth/operatorSession";
import { resolveSmsConfigFromProcessEnv } from "@/server/config/smsConfig";
import { resolveBillingConfigFromProcessEnv } from "@/server/config/billingConfig";
import { PLAN_PRICES } from "@/domain/billing/planPricing";
import type { PlanId } from "@/domain/billing/planCatalog";

/**
 * 2026-09-30追加(PO承認、公開前チェックP0)。
 *
 * 本番環境変数(SMS_PROVIDER/BILLING_PROVIDER/Stripe Price ID)が期待どおりの
 * 設定になっているかを、運営(Operator)専用で確認する読み取り専用エンドポイント。
 *
 * 【期限管理(PO指示)】このルートは本番確認完了後、担当Claudeが削除する。
 * 削除予定日: 本番確認完了から3営業日以内。削除コミットは本ファイルと
 * 対応するテストファイルの両方を対象とする。恒久的な公開エンドポイントとして
 * 残さない。
 *
 * 【設計方針】
 * - 認証: 既存のOperatorセッション(getCurrentOperator)必須。未認証は401。
 * - 応答: 各項目のtrue/false判定のみ。環境変数の値、Stripeの価格ID、
 *   APIキー、Stripeのエラーレスポンス本文は一切含めない。
 * - キャッシュ: Cache-Control: no-store(ブラウザ・CDNキャッシュ禁止)。
 * - 副作用: SMS送信・メール送信・決済作成は一切行わない(Stripeへは
 *   価格情報のGETのみ、Twilioへは一切アクセスしない)。
 */

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

interface StripePriceCheckResult {
  exists: boolean;
  amountMatches: boolean;
  currencyIsJpy: boolean;
  isMonthly: boolean;
  isLive: boolean;
}

async function verifyStripePrice(
  secretKey: string,
  priceId: string,
  expectedYen: number
): Promise<StripePriceCheckResult> {
  try {
    const res = await fetch(`https://api.stripe.com/v1/prices/${encodeURIComponent(priceId)}`, {
      headers: { Authorization: `Bearer ${secretKey}` },
      cache: "no-store",
    });
    if (!res.ok) {
      return { exists: false, amountMatches: false, currencyIsJpy: false, isMonthly: false, isLive: false };
    }
    const price = (await res.json()) as {
      unit_amount?: number;
      currency?: string;
      recurring?: { interval?: string };
      livemode?: boolean;
    };
    return {
      exists: true,
      amountMatches: price.unit_amount === expectedYen,
      currencyIsJpy: price.currency === "jpy",
      isMonthly: price.recurring?.interval === "month",
      isLive: price.livemode === true,
    };
  } catch {
    // fetch自体の例外(ネットワークエラー等)。詳細は返さない。
    return { exists: false, amountMatches: false, currencyIsJpy: false, isMonthly: false, isLive: false };
  }
}

export async function GET() {
  const operator = await getCurrentOperator();
  if (!operator) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401, headers: NO_STORE_HEADERS });
  }

  let sms: { providerIsTwilioVerify: boolean; configValid: boolean };
  try {
    const smsConfig = resolveSmsConfigFromProcessEnv();
    sms = { providerIsTwilioVerify: smsConfig.provider === "twilio-verify", configValid: true };
  } catch {
    sms = { providerIsTwilioVerify: false, configValid: false };
  }

  let billing: { providerIsStripe: boolean; configValid: boolean };
  const prices: Partial<Record<PlanId, StripePriceCheckResult>> = {};

  try {
    const billingConfig = resolveBillingConfigFromProcessEnv();
    billing = { providerIsStripe: billingConfig.provider === "stripe", configValid: true };

    if (billingConfig.provider === "stripe") {
      const planIds: PlanId[] = ["light", "standard", "premium"];
      for (const planId of planIds) {
        const priceId = billingConfig.stripePriceIds[planId];
        const expectedYen = PLAN_PRICES[planId].monthlyYenIncludingTax;
        prices[planId] = await verifyStripePrice(billingConfig.apiKey, priceId, expectedYen);
      }
    }
  } catch {
    billing = { providerIsStripe: false, configValid: false };
  }

  return NextResponse.json({ sms, billing, prices }, { status: 200, headers: NO_STORE_HEADERS });
}
