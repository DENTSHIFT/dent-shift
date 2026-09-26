import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db/prismaClient";
import { resolveSmsConfigFromProcessEnv } from "@/server/config/smsConfig";
import { createTwilioVerifySmsProvider } from "@/server/providers/sms/twilioVerifySmsProvider";
import { generateContactPasswordResetToken } from "@/server/auth/contactPasswordResetToken";
import { canCheckSmsCode, PASSWORD_RESET_SMS_INVALID_CODE_MESSAGE } from "@/domain/auth/passwordReset";

// アカウントなし・送信前・期限切れ・誤コード・試行上限はすべて同一の400にする。
export async function POST(request: NextRequest) {
  const invalid = () =>
    NextResponse.json({ error: PASSWORD_RESET_SMS_INVALID_CODE_MESSAGE }, { status: 400 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "リクエストボディがJSONとして解釈できません" }, { status: 400 });
  }
  const { email, code } = (body ?? {}) as Record<string, unknown>;
  if (typeof email !== "string" || !email.trim() || typeof code !== "string" || !code.trim()) {
    return invalid();
  }

  const contact = await prisma.contact.findUnique({ where: { email: email.trim() } });
  if (!contact || !contact.phoneNumber || !canCheckSmsCode(contact, new Date())) return invalid();

  let result: "approved" | "denied" | "expired";
  try {
    const config = resolveSmsConfigFromProcessEnv();
    if (config.provider === "disabled") return invalid();
    result = await createTwilioVerifySmsProvider(config).checkVerification(contact.phoneNumber, code.trim());
  } catch {
    console.error("[POST /api/auth/password-reset/sms/verify] verification check failed");
    return invalid();
  }

  if (result !== "approved") {
    await prisma.contact.update({
      where: { id: contact.id },
      data: { passwordResetSmsAttemptCount: { increment: 1 } },
    });
    return invalid();
  }

  const { token, tokenHash, expiresAt } = generateContactPasswordResetToken();
  await prisma.contact.update({
    where: { id: contact.id },
    data: {
      passwordResetTokenHash: tokenHash,
      passwordResetExpiresAt: expiresAt,
      passwordResetSmsSentAt: null,
      passwordResetSmsAttemptCount: 0,
    },
  });
  return NextResponse.json({ token }, { status: 200 });
}
