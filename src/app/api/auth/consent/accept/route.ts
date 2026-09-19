import { NextResponse } from "next/server";
import { prisma } from "@/server/db/prismaClient";
import { getCurrentContact } from "@/server/auth/session";
import { canTransitionRegistrationStep, type RegistrationStep } from "@/domain/auth/registrationStep";
import { activateTrialIfEligible } from "@/server/services/activateTrial";

/**
 * 規約・プライバシーポリシー同意(指示書4章)。SMS・メール・決済方法登録と並び、
 * trial開始の必須条件のひとつ。
 */
export async function POST() {
  const contact = await getCurrentContact();
  if (!contact) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }

  const nextStep: RegistrationStep = "completed";
  const currentStep = contact.registrationStep as RegistrationStep;
  const updatedStep = canTransitionRegistrationStep(currentStep, nextStep) ? nextStep : currentStep;

  await prisma.contact.update({
    where: { id: contact.id },
    data: { consentAcceptedAt: new Date(), registrationStep: updatedStep },
  });

  await activateTrialIfEligible(contact.id).catch((error) => {
    console.error("[POST /api/auth/consent/accept] activateTrialIfEligible failed:", error);
  });

  return NextResponse.json({ status: "accepted" }, { status: 200 });
}
