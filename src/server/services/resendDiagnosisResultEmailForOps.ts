import "server-only";
import { prisma } from "@/server/db/prismaClient";
import { getDiagnosisById, updateDiagnosisResultEmailStatus } from "@/server/db/diagnosisRepository";
import { sendDiagnosisResultEmail } from "@/server/services/sendDiagnosisResultEmail";

export type OpsResendResultEmailOutcome =
  | "sent"
  | "disabled"
  | "failed"
  | "diagnosis_not_found"
  | "no_recipient_email";

/**
 * ops専用: 診断結果メール送信に失敗した(resultEmailStatus="failed")診断を、
 * 運営者が手動で再送する。診断本体は再実行せず、保存済みのDiagnosis行から
 * DiagnosisResultEmailSourceを再構築して同じテンプレートで送り直すだけなので、
 * AI計測・課金等には一切触れない(2026-09-24)。
 */
export async function resendDiagnosisResultEmailForOps(
  diagnosisId: string
): Promise<OpsResendResultEmailOutcome> {
  const diagnosis = await getDiagnosisById(diagnosisId);
  if (!diagnosis) return "diagnosis_not_found";

  const clinic = await prisma.clinic.findUnique({
    where: { id: diagnosis.clinicId },
    select: { contactEmail: true },
  });
  if (!clinic?.contactEmail) return "no_recipient_email";

  try {
    const status = await sendDiagnosisResultEmail({
      to: clinic.contactEmail,
      diagnosisId,
      result: {
        clinicName: diagnosis.clinicName,
        isSample: diagnosis.isSample,
        topImprovements: diagnosis.topImprovements,
        scoreBreakdown: diagnosis.scoreBreakdown,
      },
    });
    await updateDiagnosisResultEmailStatus(diagnosisId, status === "sent" ? "sent" : "disabled");
    return status;
  } catch (error) {
    console.error(
      "[resendDiagnosisResultEmailForOps] send failed:",
      error instanceof Error ? error.name : "UnknownError"
    );
    await updateDiagnosisResultEmailStatus(diagnosisId, "failed").catch(() => {});
    return "failed";
  }
}
