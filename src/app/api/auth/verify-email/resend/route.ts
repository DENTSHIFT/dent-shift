import { NextResponse } from "next/server";
import { getCurrentContact } from "@/server/auth/session";
import { sendEmailVerification } from "@/server/services/sendEmailVerification";
import { EMAIL_VERIFICATION_TTL_MS } from "@/server/auth/emailVerificationToken";
import { ResultEmailDeliveryError } from "@/server/providers/email/resendEmailProvider";

const RESEND_MIN_INTERVAL_MS = 1000 * 60; // 1分

export async function POST() {
  const contact = await getCurrentContact();
  if (!contact) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }
  if (contact.emailVerifiedAt) {
    return NextResponse.json({ status: "already_verified" }, { status: 200 });
  }

  if (contact.emailVerificationExpiresAt) {
    const issuedAt = contact.emailVerificationExpiresAt.getTime() - EMAIL_VERIFICATION_TTL_MS;
    if (Date.now() - issuedAt < RESEND_MIN_INTERVAL_MS) {
      return NextResponse.json({ error: "再送は1分間隔でのみ可能です" }, { status: 429 });
    }
  }

  let status;
  try {
    status = await sendEmailVerification({
      contactId: contact.id,
      email: contact.email,
      clinicName: contact.clinic.name,
    });
  } catch (error) {
    if (error instanceof ResultEmailDeliveryError) {
      console.error("[POST /api/auth/verify-email/resend] email delivery failed:", error.message);
      return NextResponse.json(
        { error: "確認メールを送信できませんでした。時間をおいて再度お試しください" },
        { status: 502 }
      );
    }
    throw error;
  }

  return NextResponse.json({ status }, { status: 200 });
}
