import "server-only";
import { getInviteByCode } from "@/server/db/inviteRepository";
import { validateInvite } from "@/domain/invite/inviteCode";
import { resolveBillingConfigFromProcessEnv, BillingConfigError } from "@/server/config/billingConfig";
import { createStripeInviteCheckoutSession } from "@/server/providers/billing/stripeCheckoutProvider";

export class InviteCheckoutError extends Error {
  constructor(
    message: string,
    public readonly code: "not_found" | "email_mismatch" | "config_error" | "stripe_error"
  ) {
    super(message);
  }
}

/**
 * 知人院長向け「1円モニター利用」専用Checkoutの作成。通常プラン(billing/checkout/route.ts)
 * とは完全に別の入口・別のPrice・別のStripeパラメータ(cancel_at)を使う。
 * 招待の消費(usedCount++)はここでは行わない。決済完了はWebhookで確認するまで
 * 確定させない(仕様書の「使用回数制限」「1回限定なら使用後に無効化」を、
 * 実際に支払いが完了した時点でのみ確定させるため)。
 */
export async function requestInviteCheckout(input: {
  inviteCode: string;
  clinicId: string;
  contactEmail: string;
}): Promise<{ checkoutUrl: string }> {
  const invite = await getInviteByCode(input.inviteCode);
  if (!invite) {
    throw new InviteCheckoutError("この招待URLは無効です。", "not_found");
  }
  const validation = validateInvite({
    status: invite.status,
    startsAt: invite.startsAt,
    expiresAt: invite.expiresAt,
    maxUses: invite.maxUses,
    usedCount: invite.usedCount,
  });
  if (!validation.valid) {
    throw new InviteCheckoutError("この招待URLは現在ご利用いただけません。", "not_found");
  }
  if (invite.requireEmailMatch && invite.email.toLowerCase() !== input.contactEmail.toLowerCase()) {
    throw new InviteCheckoutError(
      "この招待は招待先メールアドレス宛です。招待メールに記載のメールアドレスでログインしてください。",
      "email_mismatch"
    );
  }

  let billingConfig;
  try {
    billingConfig = resolveBillingConfigFromProcessEnv();
  } catch (error) {
    if (error instanceof BillingConfigError) {
      throw new InviteCheckoutError("現在この機能は利用できません。", "config_error");
    }
    throw error;
  }
  if (billingConfig.provider !== "stripe") {
    throw new InviteCheckoutError("現在この機能は利用できません。", "config_error");
  }

  try {
    const { url } = await createStripeInviteCheckoutSession({
      apiKey: billingConfig.apiKey,
      priceId: invite.stripePriceId,
      clinicId: input.clinicId,
      contactEmail: input.contactEmail,
      appBaseUrl: billingConfig.appBaseUrl,
      successPath: `/invite/${encodeURIComponent(input.inviteCode)}?checkout=success`,
      cancelPath: `/invite/${encodeURIComponent(input.inviteCode)}?checkout=cancelled`,
      metadata: {
        clinicId: input.clinicId,
        // 機能判定上はstandard相当として扱う(PlanIdに4つ目の値は追加しない)。
        plan: "standard",
        inviteCode: invite.inviteCode,
        inviteId: invite.id,
      },
    });
    return { checkoutUrl: url };
  } catch {
    throw new InviteCheckoutError("決済画面を開始できませんでした。時間をおいて再度お試しください。", "stripe_error");
  }
}
