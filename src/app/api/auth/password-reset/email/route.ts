import { after, NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db/prismaClient";
import { sendContactPasswordResetEmail } from "@/server/services/sendContactPasswordResetEmail";
import {
  PASSWORD_RESET_EMAIL_GENERIC_MESSAGE,
  PASSWORD_RESET_EMAIL_MIN_INTERVAL_MS,
} from "@/domain/auth/passwordReset";

// アカウントの有無・送信可否を外部から判別できないよう、常に同一レスポンスを返す。
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

  // 応答時間でアカウントの有無を推測されないよう、DB検索(存在有無に関わらず1回)だけ
  // 済ませて先に同一レスポンスを返し、更新・メール送信は応答後に実行する。
  const contact = await prisma.contact.findUnique({ where: { email: email.trim() } });
  if (contact) {
    after(async () => {
      const now = new Date();
      const throttled =
        contact.passwordResetEmailRequestedAt &&
        now.getTime() - contact.passwordResetEmailRequestedAt.getTime() < PASSWORD_RESET_EMAIL_MIN_INTERVAL_MS;
      if (throttled) return;
      try {
        await prisma.contact.update({
          where: { id: contact.id },
          data: { passwordResetEmailRequestedAt: now },
        });
        await sendContactPasswordResetEmail({ contactId: contact.id, email: contact.email });
      } catch {
        console.error("[POST /api/auth/password-reset/email] delivery failed");
      }
    });
  }
  return NextResponse.json({ message: PASSWORD_RESET_EMAIL_GENERIC_MESSAGE }, { status: 200 });
}
