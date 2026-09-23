import "server-only";
import { prisma } from "@/server/db/prismaClient";
import { resolveResultEmailConfigFromProcessEnv } from "@/server/config/resultEmailConfig";
import { sendWithResend } from "@/server/providers/email/resendEmailProvider";
import type { SubscriptionStatus } from "@/domain/billing/subscriptionStatus";

const NOTIFICATION_EMAIL_FROM = "support@dentshift.jp";

export class BillingStatusEmailConfigError extends Error {}

export type BillingStatusEmailDeliveryStatus = "disabled" | "sent" | "no_recipients";

interface BillingStatusEmailContent {
  subject: string;
  text: string;
  html: string;
}

/**
 * 契約状態の悪化・解約を伝える通知メールの文面。秘密情報(Stripe ID・トークン等)は
 * 一切含めず、「お支払いに問題がある」「利用停止中」等、一般利用者に分かりやすい
 * 表現に留める(要件: 分かりやすい文面、CTAはダッシュボードへの遷移のみ)。
 */
function buildBillingStatusEmailContent(input: {
  status: Exclude<SubscriptionStatus, "trial" | "active" | "cancel_scheduled">;
  dashboardUrl: string;
}): BillingStatusEmailContent {
  const { status, dashboardUrl } = input;

  if (status === "cancelled") {
    return {
      subject: "【DENT SHIFT】ご契約が終了しました",
      text: [
        "DENT SHIFTのご契約が終了しました。",
        "",
        "引き続きご利用をご希望の場合は、ダッシュボードから再度お申し込みいただけます。",
        dashboardUrl,
        "",
        "ご不明な点がございましたらお問い合わせください。",
      ].join("\n"),
      html: `
        <p>DENT SHIFTのご契約が終了しました。</p>
        <p>引き続きご利用をご希望の場合は、ダッシュボードから再度お申し込みいただけます。</p>
        <p><a href="${dashboardUrl}">${dashboardUrl}</a></p>
        <p>ご不明な点がございましたらお問い合わせください。</p>
      `,
    };
  }

  // past_due / restricted / suspended は同一文面(お支払い確認のお願い)とする。
  // 状態ごとの技術的な違いは利用者に説明する必要がなく、いずれも「お支払い情報の
  // ご確認をお願いします」で足りるため(要件: 分かりやすい文面)。
  return {
    subject: "【DENT SHIFT】お支払い情報のご確認をお願いします",
    text: [
      "DENT SHIFTのご契約について、決済に問題があるため確認が必要な状態です。",
      "",
      "お手数ですが、ダッシュボードからお支払い情報をご確認ください。",
      dashboardUrl,
      "",
      "解決しない場合、一部機能のご利用を制限させていただくことがあります。",
      "ご不明な点がございましたらお問い合わせください。",
    ].join("\n"),
    html: `
      <p>DENT SHIFTのご契約について、決済に問題があるため確認が必要な状態です。</p>
      <p>お手数ですが、ダッシュボードからお支払い情報をご確認ください。</p>
      <p><a href="${dashboardUrl}">${dashboardUrl}</a></p>
      <p>解決しない場合、一部機能のご利用を制限させていただくことがあります。</p>
      <p>ご不明な点がございましたらお問い合わせください。</p>
    `,
  };
}

/**
 * 契約状態が悪化方向(past_due/restricted/suspended)または解約(cancelled)へ
 * 遷移した際に、そのClinicに紐づく全Contactへ通知する。呼び出し側
 * (billing/webhook/route.ts)は、billingRepository.applyBillingWebhookEventが
 * 実際に状態遷移した場合のみ呼び出すため、Webhook再送による重複送信は起きない。
 *
 * メール基盤が無効の場合はdisabledを返し、送信失敗は例外を投げる(呼び出し側で
 * catchしてログのみ記録し、Webhook自体は200を返す設計)。
 */
export async function sendBillingStatusChangeEmail(input: {
  clinicId: string;
  status: SubscriptionStatus;
}): Promise<BillingStatusEmailDeliveryStatus> {
  if (input.status === "trial" || input.status === "active" || input.status === "cancel_scheduled") {
    // 通知対象外の状態(呼び出し側のガードと二重チェック)。
    return "disabled";
  }

  const config = resolveResultEmailConfigFromProcessEnv();
  if (config.provider === "disabled") return "disabled";

  const dentshiftApiKey = process.env.RESEND_API_KEY_DENTSHIFT?.trim();
  if (!dentshiftApiKey) {
    throw new BillingStatusEmailConfigError(
      "RESEND_API_KEY_DENTSHIFT is not configured; cannot send billing status email."
    );
  }

  const contacts = await prisma.contact.findMany({
    where: { clinicId: input.clinicId },
    select: { email: true },
  });
  if (contacts.length === 0) return "no_recipients";

  const dashboardUrl = new URL("/dashboard", config.appBaseUrl).toString();
  const content = buildBillingStatusEmailContent({
    status: input.status as Exclude<SubscriptionStatus, "trial" | "active" | "cancel_scheduled">,
    dashboardUrl,
  });

  for (const contact of contacts) {
    await sendWithResend({
      apiKey: dentshiftApiKey,
      from: NOTIFICATION_EMAIL_FROM,
      to: contact.email,
      message: content,
    });
  }
  return "sent";
}
