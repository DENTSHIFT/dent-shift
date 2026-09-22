import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db/prismaClient";
import { getCurrentContact } from "@/server/auth/session";
import { resolveSmsConfigFromProcessEnv, SmsConfigError } from "@/server/config/smsConfig";
import {
  createTwilioVerifySmsProvider,
  SmsDeliveryError,
} from "@/server/providers/sms/twilioVerifySmsProvider";
import { canTransitionRegistrationStep, type RegistrationStep } from "@/domain/auth/registrationStep";
import { enqueueIntegrationEvent } from "@/server/db/integrationEventRepository";
import { activateTrialIfEligible } from "@/server/services/activateTrial";

const MAX_ATTEMPT_COUNT = 5;

export async function POST(request: NextRequest) {
  const contact = await getCurrentContact();
  if (!contact) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }
  if (!contact.phoneNumber || contact.smsStatus === "locked") {
    return NextResponse.json({ error: "先にSMSコードの送信が必要です" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "リクエストボディがJSONとして解釈できません" }, { status: 400 });
  }
  const { code } = (body ?? {}) as Record<string, unknown>;
  if (typeof code !== "string" || !code.trim()) {
    return NextResponse.json({ error: "確認コードを入力してください" }, { status: 400 });
  }

  let config;
  try {
    config = resolveSmsConfigFromProcessEnv();
  } catch (error) {
    if (error instanceof SmsConfigError) {
      console.error("[POST /api/auth/phone/verify] SMS configuration error");
      return NextResponse.json({ error: "SMS認証は現在利用できません" }, { status: 503 });
    }
    throw error;
  }
  if (config.provider === "disabled") {
    return NextResponse.json({ error: "SMS認証は現在利用できません" }, { status: 503 });
  }

  const provider = createTwilioVerifySmsProvider(config);
  let result;
  try {
    result = await provider.checkVerification(contact.phoneNumber, code.trim());
  } catch (error) {
    if (error instanceof SmsDeliveryError) {
      console.error("[POST /api/auth/phone/verify] SMS verification check failed:", error.message);
      return NextResponse.json(
        { error: "確認コードを確認できませんでした。時間をおいて再度お試しください" },
        { status: 502 }
      );
    }
    throw error;
  }

  if (result === "expired") {
    return NextResponse.json(
      { error: "確認コードの有効期限が切れています。再送してください", code: "expired" },
      { status: 400 }
    );
  }

  if (result === "denied") {
    const nextAttemptCount = contact.smsAttemptCount + 1;
    const locked = nextAttemptCount >= MAX_ATTEMPT_COUNT;
    await prisma.contact.update({
      where: { id: contact.id },
      data: {
        smsAttemptCount: nextAttemptCount,
        smsStatus: locked ? "locked" : "failed",
      },
    });
    return NextResponse.json(
      {
        error: locked
          ? "誤入力の上限に達したため、一時的にロックされました"
          : "確認コードが正しくありません",
      },
      { status: 400 }
    );
  }

  const nextStep: RegistrationStep = "email";
  const currentStep = contact.registrationStep as RegistrationStep;
  const updatedStep = canTransitionRegistrationStep(currentStep, nextStep)
    ? nextStep
    : currentStep;

  await prisma.contact.update({
    where: { id: contact.id },
    data: {
      phoneVerifiedAt: new Date(),
      smsStatus: "verified",
      registrationStep: updatedStep,
    },
  });

  await enqueueIntegrationEvent({
    eventType: "phone_verified",
    clinicId: contact.clinicId,
    contactId: contact.id,
    payload: { registration_step: updatedStep },
  }).catch((error) => {
    console.error("[POST /api/auth/phone/verify] Salesforce sync enqueue failed:", error);
  });

  await activateTrialIfEligible(contact.id).catch((error) => {
    console.error("[POST /api/auth/phone/verify] activateTrialIfEligible failed:", error);
  });

  return NextResponse.json({ status: "verified" }, { status: 200 });
}
