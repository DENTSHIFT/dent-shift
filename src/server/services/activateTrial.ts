import "server-only";
import { prisma } from "@/server/db/prismaClient";
import { setSubscriptionTrialPeriod } from "@/server/db/billingRepository";
import { isEligibleForTrialActivation, computeTrialEndsAt } from "@/domain/billing/trialActivation";
import { canTransitionRegistrationStep } from "@/domain/auth/registrationStep";
import { enqueueIntegrationEvent } from "@/server/db/integrationEventRepository";

/**
 * SMS認証・メール確認・規約同意・決済方法登録の4条件を確認し、すべて揃った時だけ
 * trialStartedAtを設定する(指示書4章)。各条件が更新されるたびに呼び出す想定のため、
 * 未充足の場合は何もせず正常終了する(呼び出し元をエラーにしない)。
 */
export async function activateTrialIfEligible(contactId: string): Promise<void> {
  const contact = await prisma.contact.findUnique({ where: { id: contactId } });
  if (!contact) return;

  const subscription = await prisma.subscription.findFirst({
    where: { clinicId: contact.clinicId },
    orderBy: { createdAt: "desc" },
  });
  if (!subscription) return;

  const eligible = isEligibleForTrialActivation({
    planId: subscription.plan,
    phoneVerifiedAt: contact.phoneVerifiedAt,
    emailVerifiedAt: contact.emailVerifiedAt,
    consentAcceptedAt: contact.consentAcceptedAt,
    paymentMethodStatus: subscription.paymentMethodStatus,
    trialStartedAt: subscription.trialStartedAt,
  });
  if (!eligible) return;

  const trialStartedAt = new Date();
  const trialEndsAt = computeTrialEndsAt(trialStartedAt);
  await setSubscriptionTrialPeriod({
    subscriptionId: subscription.id,
    trialStartedAt,
    trialEndsAt,
  });

  const currentStep = contact.registrationStep as Parameters<typeof canTransitionRegistrationStep>[0];
  const updatedStep = canTransitionRegistrationStep(currentStep, "completed")
    ? "completed"
    : currentStep;
  await prisma.contact.update({
    where: { id: contact.id },
    data: { registrationStep: updatedStep },
  });

  await enqueueIntegrationEvent({
    eventType: "trial_started",
    clinicId: contact.clinicId,
    contactId: contact.id,
    payload: { registration_step: updatedStep, trial_ends_at: trialEndsAt.toISOString() },
  }).catch((error) => {
    console.error("[activateTrial] Salesforce sync enqueue failed:", error);
  });
}
