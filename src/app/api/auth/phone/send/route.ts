import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db/prismaClient";
import { getCurrentContact } from "@/server/auth/session";
import { normalizeJapanesePhoneNumberToE164, PhoneNumberFormatError } from "@/domain/auth/phoneNumber";
import { resolveSmsConfigFromProcessEnv } from "@/server/config/smsConfig";
import { createTwilioVerifySmsProvider } from "@/server/providers/sms/twilioVerifySmsProvider";
import { enqueueIntegrationEvent } from "@/server/db/integrationEventRepository";

const RESEND_MIN_INTERVAL_MS = 1000 * 60; // 1分
const MAX_RESEND_COUNT = 5; // 1登録あたりの送信上限
const LOCK_COOLDOWN_MS = 1000 * 60 * 15; // 誤入力上限到達後のロック解除待ち時間

export async function POST(request: NextRequest) {
  const contact = await getCurrentContact();
  if (!contact) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "リクエストボディがJSONとして解釈できません" }, { status: 400 });
  }
  const { phoneNumber } = (body ?? {}) as Record<string, unknown>;
  if (typeof phoneNumber !== "string" || !phoneNumber.trim()) {
    return NextResponse.json({ error: "電話番号を入力してください" }, { status: 400 });
  }

  let normalizedPhone: string;
  try {
    normalizedPhone = normalizeJapanesePhoneNumberToE164(phoneNumber);
  } catch (error) {
    if (error instanceof PhoneNumberFormatError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  // 同一番号の重複登録判定(自分自身の再送は許容)。
  const duplicate = await prisma.contact.findFirst({
    where: { phoneNumber: normalizedPhone, phoneVerifiedAt: { not: null }, id: { not: contact.id } },
  });
  if (duplicate) {
    return NextResponse.json(
      { error: "この電話番号は既に別のアカウントで認証済みです" },
      { status: 409 }
    );
  }

  if (contact.smsStatus === "locked" && contact.smsSentAt) {
    const cooldownEndsAt = contact.smsSentAt.getTime() + LOCK_COOLDOWN_MS;
    if (Date.now() < cooldownEndsAt) {
      return NextResponse.json(
        { error: "誤入力の上限に達しました。しばらく待ってから再度お試しください" },
        { status: 429 }
      );
    }
  }

  if (contact.smsSentAt && Date.now() - contact.smsSentAt.getTime() < RESEND_MIN_INTERVAL_MS) {
    return NextResponse.json({ error: "再送は1分間隔でのみ可能です" }, { status: 429 });
  }

  const isResend = contact.phoneNumber === normalizedPhone;
  const nextResendCount = isResend ? contact.smsResendCount + 1 : 0;
  if (nextResendCount > MAX_RESEND_COUNT) {
    return NextResponse.json(
      { error: "送信回数の上限に達しました。時間をおいて再度お試しください" },
      { status: 429 }
    );
  }

  const config = resolveSmsConfigFromProcessEnv();
  if (config.provider === "disabled") {
    return NextResponse.json(
      { error: "SMS認証は現在利用できません" },
      { status: 503 }
    );
  }

  const provider = createTwilioVerifySmsProvider(config);
  await provider.sendVerification(normalizedPhone);

  await prisma.contact.update({
    where: { id: contact.id },
    data: {
      phoneNumber: normalizedPhone,
      smsStatus: "sent",
      smsSentAt: new Date(),
      smsAttemptCount: 0,
      smsResendCount: nextResendCount,
    },
  });

  await enqueueIntegrationEvent({
    eventType: isResend ? "sms_verification_sent" : "phone_added",
    clinicId: contact.clinicId,
    contactId: contact.id,
    payload: { registration_step: contact.registrationStep },
  }).catch((error) => {
    console.error("[POST /api/auth/phone/send] Salesforce sync enqueue failed:", error);
  });

  return NextResponse.json({ status: "sent" }, { status: 200 });
}
