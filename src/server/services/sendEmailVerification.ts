import "server-only";
import { prisma } from "@/server/db/prismaClient";
import { buildEmailVerificationMessage } from "@/domain/email/emailVerification";
import { resolveResultEmailConfigFromProcessEnv } from "@/server/config/resultEmailConfig";
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

  const verifyUrl = new URL("/api/auth/verify-email", config.appBaseUrl);
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
