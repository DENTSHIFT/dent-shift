import "server-only";
import { prisma } from "@/server/db/prismaClient";
import { hashEmailVerificationToken } from "@/server/auth/emailVerificationToken";
import { canTransitionRegistrationStep, type RegistrationStep } from "@/domain/auth/registrationStep";
import { enqueueIntegrationEvent } from "@/server/db/integrationEventRepository";

export type VerifyEmailTokenResult =
  | { status: "verified"; contactId: string; email: string }
  | { status: "already_verified"; contactId: string; email: string }
  | { status: "error"; code: "invalid" | "expired"; message: string };

/**
 * メール確認トークンの検証・消費処理(APIルートとUI画面の両方から共通で呼ぶ)。
 * トークンは平文で受け取るが、照合はDBに保存済みのハッシュと突き合わせて行う。
 * 2026-09-24: /api/auth/verify-email/route.tsから処理本体をここへ切り出し、
 * /verify-emailページ(UI)からも同じ処理を直接呼べるようにした
 * (API層とUI表示を分離。既存のAPI挙動・レスポンス形は変えない)。
 */
export async function verifyEmailToken(token: string): Promise<VerifyEmailTokenResult> {
  const tokenHash = hashEmailVerificationToken(token);
  const contact = await prisma.contact.findFirst({
    where: { emailVerificationTokenHash: tokenHash },
  });

  if (!contact) {
    return { status: "error", code: "invalid", message: "確認リンクが無効です" };
  }
  if (contact.emailVerifiedAt) {
    return { status: "already_verified", contactId: contact.id, email: contact.email };
  }
  if (!contact.emailVerificationExpiresAt || contact.emailVerificationExpiresAt < new Date()) {
    return {
      status: "error",
      code: "expired",
      message: "確認リンクの有効期限が切れています。再送してください",
    };
  }

  // 2026-09-25: メール確認の次は規約同意(その後にプラン選択・決済方法登録)。
  const nextStep: RegistrationStep = "consent";
  const currentStep = contact.registrationStep as RegistrationStep;
  const updatedStep = canTransitionRegistrationStep(currentStep, nextStep) ? nextStep : currentStep;

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
    console.error("[verifyEmailToken] Salesforce sync enqueue failed:", error);
  });

  return { status: "verified", contactId: contact.id, email: contact.email };
}
