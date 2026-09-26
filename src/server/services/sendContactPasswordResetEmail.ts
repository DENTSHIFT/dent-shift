import "server-only";
import { prisma } from "@/server/db/prismaClient";
import { resolveResultEmailConfigFromProcessEnv } from "@/server/config/resultEmailConfig";
import { sendWithResend } from "@/server/providers/email/resendEmailProvider";
import {
  generateContactPasswordResetToken,
  CONTACT_PASSWORD_RESET_TTL_MS,
} from "@/server/auth/contactPasswordResetToken";
import { wrapEmailBodyHtml } from "@/domain/email/emailBranding";

const RESET_EMAIL_FROM = "support@dentshift.jp";

export async function sendContactPasswordResetEmail(input: { contactId: string; email: string }) {
  const config = resolveResultEmailConfigFromProcessEnv();
  if (config.provider === "disabled") return "disabled" as const;
  const apiKey = process.env.RESEND_API_KEY_DENTSHIFT?.trim();
  if (!apiKey) throw new Error("RESEND_API_KEY_DENTSHIFT is not configured.");

  const { token, tokenHash, expiresAt } = generateContactPasswordResetToken();
  await prisma.contact.update({
    where: { id: input.contactId },
    data: { passwordResetTokenHash: tokenHash, passwordResetExpiresAt: expiresAt },
  });

  const resetUrl = new URL("/reset-password", config.appBaseUrl);
  resetUrl.searchParams.set("token", token);
  const ttlMinutes = Math.round(CONTACT_PASSWORD_RESET_TTL_MS / 60_000);
  const text = [
    "DENT SHIFTのパスワード再設定リクエストを受け付けました。",
    "",
    "以下のURLから新しいパスワードを設定してください。",
    resetUrl.toString(),
    "",
    `このURLの有効期限は${ttlMinutes}分です。`,
    "",
    "このリクエストに心当たりがない場合は、このメールを無視してください。",
  ].join("\n");
  const html = wrapEmailBodyHtml(`
    <p>DENT SHIFTのパスワード再設定リクエストを受け付けました。</p>
    <p>以下のURLから新しいパスワードを設定してください。</p>
    <p><a href="${resetUrl.toString()}">${resetUrl.toString()}</a></p>
    <p>このURLの有効期限は${ttlMinutes}分です。</p>
    <p>このリクエストに心当たりがない場合は、このメールを無視してください。</p>
  `);
  await sendWithResend({
    apiKey,
    from: RESET_EMAIL_FROM,
    to: input.email,
    message: { subject: "【DENT SHIFT】パスワード再設定のご案内", text, html },
  });
  return "sent" as const;
}
