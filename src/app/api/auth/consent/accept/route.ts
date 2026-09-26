import { NextResponse } from "next/server";
import { prisma } from "@/server/db/prismaClient";
import { getCurrentContact } from "@/server/auth/session";
import { canTransitionRegistrationStep, type RegistrationStep } from "@/domain/auth/registrationStep";

/**
 * 規約・プライバシーポリシー同意。メール確認の次、プラン選択・決済方法登録の前のステップ。
 * 同意日時(consentAcceptedAt)を保存し、規約同意前のStripe Checkoutを
 * checkout API側でサーバー拒否する根拠にする(evaluateCheckoutEligibility)。
 */
export async function POST() {
  const contact = await getCurrentContact();
  if (!contact) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }
  if (!contact.emailVerifiedAt) {
    return NextResponse.json(
      { error: "先にメールアドレスの確認を完了してください" },
      { status: 409 }
    );
  }

  const currentStep = contact.registrationStep as RegistrationStep;
  // 同意ステップにいる場合のみ決済ステップへ進める(それ以前のステップを飛ばさない)。
  const updatedStep =
    currentStep === "consent" && canTransitionRegistrationStep(currentStep, "payment")
      ? "payment"
      : currentStep;

  const consentAcceptedAt = contact.consentAcceptedAt ?? new Date();
  await prisma.contact.update({
    where: { id: contact.id },
    data: { consentAcceptedAt, registrationStep: updatedStep },
  });

  return NextResponse.json({ status: "accepted" }, { status: 200 });
}
