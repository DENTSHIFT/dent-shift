import { prisma } from "./prismaClient";
import type { RunFreeDiagnosisResult } from "@/server/services/runFreeDiagnosis";

/**
 * P0時点ではclinic_idベースのマルチテナント分離を厳密に強制する認証がまだ無いため、
 * この repository はサービス層からのみ呼び出す前提の薄いラッパーとする。
 * Step4(認証)実装後、ここに clinicId を必須引数化してテナント境界を強制する
 * (SECURITY.md 2章の方針)。
 */
export async function saveDiagnosisResult(
  input: { clinicUrl: string; contactEmail: string; gbpUrl?: string; bookingUrl?: string },
  result: RunFreeDiagnosisResult
) {
  const clinic = await prisma.clinic.create({
    data: {
      name: result.clinicName,
      url: input.clinicUrl,
      gbpUrl: input.gbpUrl,
      bookingUrl: input.bookingUrl,
    },
  });

  const diagnosis = await prisma.diagnosis.create({
    data: {
      clinicId: clinic.id,
      totalPoints: result.scoreBreakdown.totalPoints,
      totalStatus: result.scoreBreakdown.totalStatus,
      scoreBreakdownJson: JSON.stringify(result.scoreBreakdown),
      competitorsJson: JSON.stringify(result.competitors),
      questionResultsJson: JSON.stringify(result.questionResults),
      improvementTasksJson: JSON.stringify(result.topImprovements),
      dataDisclaimer: result.dataDisclaimer,
    },
  });

  return { clinicId: clinic.id, diagnosisId: diagnosis.id };
}

export async function getDiagnosisById(diagnosisId: string) {
  const diagnosis = await prisma.diagnosis.findUnique({
    where: { id: diagnosisId },
    include: { clinic: true },
  });
  if (!diagnosis) return null;

  return {
    clinicName: diagnosis.clinic.name,
    clinicUrl: diagnosis.clinic.url,
    totalPoints: diagnosis.totalPoints,
    totalStatus: diagnosis.totalStatus,
    scoreBreakdown: JSON.parse(diagnosis.scoreBreakdownJson),
    competitors: JSON.parse(diagnosis.competitorsJson),
    questionResults: JSON.parse(diagnosis.questionResultsJson),
    topImprovements: JSON.parse(diagnosis.improvementTasksJson),
    dataDisclaimer: diagnosis.dataDisclaimer,
    measuredAt: diagnosis.measuredAt,
  };
}
