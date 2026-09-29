import "server-only";
import { prisma } from "@/server/db/prismaClient";
import { buildEmailVerificationMessage } from "@/domain/email/emailVerification";
import {
  resolveResultEmailConfigFromProcessEnv,
  resolveEmailLinkBaseUrlFromProcessEnv,
} from "@/server/config/resultEmailConfig";
import { sendWithResend } from "@/server/providers/email/resendEmailProvider";
import { generateEmailVerificationToken } from "@/server/auth/emailVerificationToken";

export type EmailVerificationDeliveryStatus = "disabled" | "sent";

/**
 * メール確認トークンを発行してContactへ保存し、確認メールを送信する。
 * メール基盤(RESULT_EMAIL_PROVIDER)が未設定の場合は診断結果メールと同様disabledを返し、
 * 登録フロー自体は止めない(指示書6章・18章)。
 */
export async function sendEmailVerification(input: {
  contactId: string;
  email: string;
  clinicName: string;
}): Promise<EmailVerificationDeliveryStatus> {
  const config = resolveResultEmailConfigFromProcessEnv();
  const { token, tokenHash, expiresAt } = generateEmailVerificationToken();

  await prisma.contact.update({
    where: { id: input.contactId },
    data: {
      emailVerificationTokenHash: tokenHash,
      emailVerificationExpiresAt: expiresAt,
    },
  });

  if (config.provider === "disabled") return "disabled";

  // UI画面(/verify-email)へ遷移させる。2026-09-24以前は/api/auth/verify-emailの
  // 生JSONへ直接リンクしていたが、一般ユーザー向けの完了画面を表示するため変更した。
  // 2026-09-29追加(PO承認、認証導線の環境またぎ対策P0): EMAIL_LINK_BASE_URLが
  // 設定されている場合はそちらを使う(未設定時はAPP_BASE_URLのまま、本番は無変更)。
  const linkBaseUrl = resolveEmailLinkBaseUrlFromProcessEnv(config.appBaseUrl);
  const verifyUrl = new URL("/verify-email", linkBaseUrl);
  verifyUrl.searchParams.set("token", token);

  const message = buildEmailVerificationMessage({
    clinicName: input.clinicName,
    verifyUrl: verifyUrl.toString(),
  });

  await sendWithResend({
    apiKey: config.apiKey,
    from: config.from,
    to: input.email,
    message,
  });
  return "sent";
}
