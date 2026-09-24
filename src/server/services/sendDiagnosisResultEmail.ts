import "server-only";
import { buildDiagnosisResultEmail } from "@/domain/email/diagnosisResultEmail";
import type { RunFreeDiagnosisResult } from "@/server/services/runFreeDiagnosis";
import { resolveResultEmailConfigFromProcessEnv } from "@/server/config/resultEmailConfig";
import { sendWithResend } from "@/server/providers/email/resendEmailProvider";

export type ResultEmailDeliveryStatus = "disabled" | "sent";

// 2026-09-24: opsからの再送(getDiagnosisByIdの戻り値から再構築)でも呼べるよう、
// 実際にこの関数が参照するフィールドだけの最小形状にする(RunFreeDiagnosisResult
// 全体を要求すると、DB保存済みJSON由来のオブジェクトでは型が合わない)。
// 既存呼び出し元(runFreeDiagnosisの結果をそのまま渡す)は構造的に互換のため無変更で動く。
export type DiagnosisResultEmailSource = Pick<
  RunFreeDiagnosisResult,
  "clinicName" | "isSample" | "topImprovements"
> & {
  scoreBreakdown: Pick<RunFreeDiagnosisResult["scoreBreakdown"], "totalPoints" | "totalStatus" | "maxPoints">;
};

export async function sendDiagnosisResultEmail(input: {
  to: string;
  diagnosisId: string;
  result: DiagnosisResultEmailSource;
}): Promise<ResultEmailDeliveryStatus> {
  const config = resolveResultEmailConfigFromProcessEnv();
  if (config.provider === "disabled") return "disabled";

  const resultUrl = new URL(
    `/diagnosis/result/${encodeURIComponent(input.diagnosisId)}`,
    config.appBaseUrl
  ).toString();
  // Ver3.3仕様(2026-09-21): 診断結果メールから無料トライアル開始・オンライン相談へ
  // 直接導線を張る。相談URLは診断結果ページのConsultationCtaと同じ環境変数から
  // 読み込み、未設定時はメール側のCTAも描画しない(壊れたリンクを作らない)。
  const trialUrl = new URL("/plans", config.appBaseUrl).toString();
  const consultationUrl = process.env.NEXT_PUBLIC_SPECIALIST_BOOKING_URL || undefined;
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
    trialUrl,
    consultationUrl,
  });

  await sendWithResend({
    apiKey: config.apiKey,
    from: config.from,
    to: input.to,
    message,
  });
  return "sent";
}
