import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db/prismaClient";
import { hashEmailVerificationToken } from "@/server/auth/emailVerificationToken";
import { canTransitionRegistrationStep, type RegistrationStep } from "@/domain/auth/registrationStep";
import { enqueueIntegrationEvent } from "@/server/db/integrationEventRepository";
import { activateTrialIfEligible } from "@/server/services/activateTrial";

/**
 * メール本文中のリンク(GET)からの確認を受け付ける。
 * トークンは平文で受け取るが、照合はDBに保存済みのハッシュと突き合わせて行う。
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "確認トークンが指定されていません" }, { status: 400 });
  }

  const tokenHash = hashEmailVerificationToken(token);
  const contact = await prisma.contact.findFirst({
    where: { emailVerificationTokenHash: tokenHash },
  });

  if (!contact) {
    return NextResponse.json({ error: "確認リンクが無効です" }, { status: 400 });
  }
  if (contact.emailVerifiedAt) {
    return NextResponse.json({ status: "already_verified" }, { status: 200 });
  }
  if (!contact.emailVerificationExpiresAt || contact.emailVerificationExpiresAt < new Date()) {
    return NextResponse.json(
      { error: "確認リンクの有効期限が切れています。再送してください", code: "expired" },
      { status: 400 }
    );
  }

  const nextStep: RegistrationStep = "payment";
  const currentStep = contact.registrationStep as RegistrationStep;
  const updatedStep = canTransitionRegistrationStep(currentStep, nextStep)
    ? nextStep
    : currentStep;

  await prisma.contact.update({
    where: { id: contact.id },
    data: {
      emailVerifiedAt: new Date(),
      emailVerificationTokenHash: null,
      emailVerificationExpiresAt: null,
      registrationStep: updatedStep,
    },
  });

  await enqueueIntegrationEvent({
    eventType: "email_verified",
    clinicId: contact.clinicId,
    contactId: contact.id,
    payload: { registration_step: updatedStep },
  }).catch((error) => {
    console.error("[GET /api/auth/verify-email] Salesforce sync enqueue failed:", error);
  });

  await activateTrialIfEligible(contact.id).catch((error) => {
    console.error("[GET /api/auth/verify-email] activateTrialIfEligible failed:", error);
  });

  return NextResponse.json({ status: "verified" }, { status: 200 });
}
