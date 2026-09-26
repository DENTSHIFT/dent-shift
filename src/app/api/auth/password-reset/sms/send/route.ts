import { after, NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db/prismaClient";
import { resolveSmsConfigFromProcessEnv } from "@/server/config/smsConfig";
import { createTwilioVerifySmsProvider } from "@/server/providers/sms/twilioVerifySmsProvider";
import { decideSmsSend, PASSWORD_RESET_SMS_GENERIC_MESSAGE } from "@/domain/auth/passwordReset";

// 電話番号はユーザーに入力させない。登録メールアドレスで指定されたContactの、
// 認証済みの登録番号にだけ送る。該当しない場合も同一レスポンスを返す。
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "リクエストボディがJSONとして解釈できません" }, { status: 400 });
  }
  const { email } = (body ?? {}) as Record<string, unknown>;
  if (typeof email !== "string" || !email.trim()) {
    return NextResponse.json({ error: "メールアドレスを入力してください" }, { status: 400 });
  }

  // 応答時間の差(SMS送信の有無)で状態を推測されないよう、送信・DB更新は応答後に実行する。
  const contact = await prisma.contact.findUnique({ where: { email: email.trim() } });
  if (contact && contact.phoneNumber) {
    const phoneNumber = contact.phoneNumber;
    after(async () => {
      const now = new Date();
      const decision = decideSmsSend(contact, now);
      if (!decision.allowed) return;
      try {
        const config = resolveSmsConfigFromProcessEnv();
        if (config.provider === "disabled") return;
        await createTwilioVerifySmsProvider(config).sendVerification(phoneNumber);
        await prisma.contact.update({
          where: { id: contact.id },
          data: {
            passwordResetSmsSentAt: now,
            passwordResetSmsWindowStartedAt: decision.windowStartedAt,
            passwordResetSmsSendCount: decision.sendCount,
            passwordResetSmsAttemptCount: 0,
          },
        });
      } catch {
        console.error("[POST /api/auth/password-reset/sms/send] delivery failed");
      }
    });
  }
  return NextResponse.json({ message: PASSWORD_RESET_SMS_GENERIC_MESSAGE }, { status: 200 });
}
