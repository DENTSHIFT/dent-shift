import "server-only";
import { buildDiagnosisResultEmail } from "@/domain/email/diagnosisResultEmail";
import type { RunFreeDiagnosisResult } from "@/server/services/runFreeDiagnosis";
import { resolveResultEmailConfigFromProcessEnv } from "@/server/config/resultEmailConfig";
import { sendWithResend } from "@/server/providers/email/resendEmailProvider";

export type ResultEmailDeliveryStatus = "disabled" | "sent";

export async function sendDiagnosisResultEmail(input: {
  to: string;
  diagnosisId: string;
  result: RunFreeDiagnosisResult;
}): Promise<ResultEmailDeliveryStatus> {
  const config = resolveResultEmailConfigFromProcessEnv();
  if (config.provider === "disabled") return "disabled";

  const resultUrl = new URL(
    `/diagnosis/result/${encodeURIComponent(input.diagnosisId)}`,
    config.appBaseUrl
  ).toString();
  const message = buildDiagnosisResultEmail({
    clinicName: input.result.clinicName,
    resultUrl,
    totalPoints: input.result.scoreBreakdown.totalPoints,
    totalStatus: input.result.scoreBreakdown.totalStatus,
    maxPoints: input.result.scoreBreakdown.maxPoints,
    isSample: input.result.isSample,
    improvements: input.result.topImprovements.map((improvement) => ({
      title: improvement.title,
      recommendedAction: improvement.recommendedAction,
    })),
  });

  await sendWithResend({
    apiKey: config.apiKey,
    from: config.from,
    to: input.to,
    message,
  });
  return "sent";
}
