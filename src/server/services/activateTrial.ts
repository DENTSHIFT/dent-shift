import "server-only";
import { prisma } from "@/server/db/prismaClient";
import { isRegistrationComplete } from "@/domain/billing/trialActivation";
import { canTransitionRegistrationStep } from "@/domain/auth/registrationStep";
import { enqueueIntegrationEvent } from "@/server/db/integrationEventRepository";

/**
 * Stripe Checkout完了(決済方法登録済み)後に呼び、SMS・メール・規約同意がすべて済んでいれば
 * registrationStepを"completed"へ進める。冪等(既にcompletedなら何もしない)。
 *
 * 2026-09-25: トライアルの開始/終了日時(trialStartedAt/trialEndsAt)はここで独自算出せず、
 * Stripe Subscriptionのtrial_start/trial_endをcustomer.subscription.*Webhookから同期する
 * (billingRepository.applyBillingWebhookEvent)。StripeとDENT SHIFTの終了日時のずれを防ぐ。
 */
export async function activateTrialIfEligible(contactId: string): Promise<void> {
  const contact = await prisma.contact.findUnique({ where: { id: contactId } });
  if (!contact) return;
  if (contact.registrationStep === "completed") return;

  const subscription = await prisma.subscription.findFirst({
    where: { clinicId: contact.clinicId },
    orderBy: { createdAt: "desc" },
  });
  if (!subscription) return;

  const complete = isRegistrationComplete({
    phoneVerifiedAt: contact.phoneVerifiedAt,
    smsVerificationExempt: contact.smsVerificationExempt,
    emailVerifiedAt: contact.emailVerifiedAt,
    consentAcceptedAt: contact.consentAcceptedAt,
    paymentMethodStatus: subscription.paymentMethodStatus,
  });
  if (!complete) return;

  const currentStep = contact.registrationStep as Parameters<typeof canTransitionRegistrationStep>[0];
  if (!canTransitionRegistrationStep(currentStep, "completed")) return;
  await prisma.contact.update({
    where: { id: contact.id },
    data: { registrationStep: "completed" },
  });

  await enqueueIntegrationEvent({
    eventType: "trial_started",
    clinicId: contact.clinicId,
    contactId: contact.id,
    payload: {
      registration_step: "completed",
      trial_ends_at: subscription.trialEndsAt ? subscription.trialEndsAt.toISOString() : null,
    },
  }).catch((error) => {
    console.error("[activateTrial] Salesforce sync enqueue failed:", error);
  });
}
