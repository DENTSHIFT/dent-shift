import "server-only";
import { prisma } from "@/server/db/prismaClient";
import { resolveResultEmailConfigFromProcessEnv } from "@/server/config/resultEmailConfig";
import { sendWithResend } from "@/server/providers/email/resendEmailProvider";
import {
  generateOperatorPasswordResetToken,
  OPERATOR_PASSWORD_RESET_TTL_MS,
} from "@/server/auth/operatorPasswordResetToken";
import { wrapEmailBodyHtml } from "@/domain/email/emailBranding";

export type OperatorPasswordResetDeliveryStatus = "disabled" | "sent";

const RESET_EMAIL_FROM = "support@dentshift.jp";

export class OperatorPasswordResetEmailConfigError extends Error {}

/**
 * 運営者(Operator)パスワード再設定メールの送信(2026-09-23追加、翌日にAPIキーを分離)。
 *
 * 送信元は診断結果メール等のRESULT_EMAIL_FROM設定に関わらず、常にsupport@dentshift.jp固定
 * (ユーザー指示)。
 *
 * 重要: 送信に使うAPIキーは、既存のRESEND_API_KEY(診断結果メール等が使用中)とは別の
 * RESEND_API_KEY_DENTSHIFTを使う。原因調査の結果、既存のRESEND_API_KEYはResend側で
 * dentshift.jp以外のドメイン専用に発行されており、support@dentshift.jpからの送信が
 * 403で拒否されることが判明したため(2026-09-23)。RESEND_API_KEY_DENTSHIFTはdentshift.jp
 * 送信専用に新規発行したキーで、既存のRESEND_API_KEY・診断結果メール送信処理には一切
 * 触れない(同じRESULT_EMAIL_PROVIDERのdisabled/resend判定だけを流用し、有効/無効の
 * オン・オフ自体は共有する)。
 *
 * メール基盤(RESULT_EMAIL_PROVIDER)が"disabled"の場合はdisabledを返し、
 * 呼び出し側(forgot-passwordルート)は「メールアドレスの存在有無を判別できない」応答を保つ。
 */
export async function sendOperatorPasswordResetEmail(input: {
  operatorId: string;
  email: string;
}): Promise<OperatorPasswordResetDeliveryStatus> {
  const config = resolveResultEmailConfigFromProcessEnv();
  const { token, tokenHash, expiresAt } = generateOperatorPasswordResetToken();

  await prisma.operator.update({
    where: { id: input.operatorId },
    data: { passwordResetTokenHash: tokenHash, passwordResetExpiresAt: expiresAt },
  });

  if (config.provider === "disabled") return "disabled";

  const dentshiftApiKey = process.env.RESEND_API_KEY_DENTSHIFT?.trim();
  if (!dentshiftApiKey) {
    throw new OperatorPasswordResetEmailConfigError(
      "RESEND_API_KEY_DENTSHIFT is not configured; cannot send operator password reset email."
    );
  }

  const resetUrl = new URL("/ops/reset-password", config.appBaseUrl);
  resetUrl.searchParams.set("token", token);

  const ttlMinutes = Math.round(OPERATOR_PASSWORD_RESET_TTL_MS / 60_000);
  const subject = "【DENT SHIFT】管理者パスワード再設定";
  const text = [
    "DENT SHIFT管理者アカウントのパスワード再設定リクエストを受け付けました。",
    "",
    "以下のURLから新しいパスワードを設定してください。",
    resetUrl.toString(),
    "",
    `このURLの有効期限は${ttlMinutes}分です。`,
    "",
    "このリクエストに心当たりがない場合は、このメールを無視してください。",
  ].join("\n");
  const html = wrapEmailBodyHtml(`
    <p>DENT SHIFT管理者アカウントのパスワード再設定リクエストを受け付けました。</p>
    <p>以下のURLから新しいパスワードを設定してください。</p>
    <p><a href="${resetUrl.toString()}">${resetUrl.toString()}</a></p>
    <p>このURLの有効期限は${ttlMinutes}分です。</p>
    <p>このリクエストに心当たりがない場合は、このメールを無視してください。</p>
  `);

  await sendWithResend({
    apiKey: dentshiftApiKey,
    from: RESET_EMAIL_FROM,
    to: input.email,
    message: { subject, text, html },
  });
  return "sent";
}
