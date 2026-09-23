import "server-only";
import { prisma } from "@/server/db/prismaClient";
import { resolveResultEmailConfigFromProcessEnv } from "@/server/config/resultEmailConfig";
import { sendWithResend } from "@/server/providers/email/resendEmailProvider";
import {
  generateOperatorPasswordResetToken,
  OPERATOR_PASSWORD_RESET_TTL_MS,
} from "@/server/auth/operatorPasswordResetToken";

export type OperatorPasswordResetDeliveryStatus = "disabled" | "sent";

const RESET_EMAIL_FROM = "support@dentshift.jp";

/**
 * 運営者(Operator)パスワード再設定メールの送信(2026-09-23追加)。
 * 送信元は診断結果メール等のRESULT_EMAIL_FROM設定に関わらず、常にsupport@dentshift.jp固定
 * (ユーザー指示)。メール基盤(RESULT_EMAIL_PROVIDER)が未設定の場合はdisabledを返し、
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
  const html = `
    <p>DENT SHIFT管理者アカウントのパスワード再設定リクエストを受け付けました。</p>
    <p>以下のURLから新しいパスワードを設定してください。</p>
    <p><a href="${resetUrl.toString()}">${resetUrl.toString()}</a></p>
    <p>このURLの有効期限は${ttlMinutes}分です。</p>
    <p>このリクエストに心当たりがない場合は、このメールを無視してください。</p>
  `;

  await sendWithResend({
    apiKey: config.apiKey,
    from: RESET_EMAIL_FROM,
    to: input.email,
    message: { subject, text, html },
  });
  return "sent";
}
