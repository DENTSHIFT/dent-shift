import { prisma } from "./prismaClient";
import type { RunFreeDiagnosisResult } from "@/server/services/runFreeDiagnosis";

/**
 * saveDiagnosisResult/getDiagnosisById(結果ページ用)は無料診断のUX上、認証なしで
 * 呼び出せる(IDを知っていれば見られる)。一方 getDiagnosesByClinicId は Step4 で追加した
 * clinicId必須のテナント境界付きクエリで、ダッシュボードなど認証済み画面専用に使う
 * (SECURITY.md 2章「テナント分離の実装方針」)。
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
    clinicId: diagnosis.clinicId,
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

/**
 * Step4: 医院側ダッシュボード用。clinicIdでスコープし、他医院のデータが混ざらないようにする
 * (SECURITY.md「テナント分離の実装方針」)。
 */
export async function getDiagnosesByClinicId(clinicId: string) {
  return prisma.diagnosis.findMany({
    where: { clinicId },
    orderBy: { measuredAt: "desc" },
    select: { id: true, totalPoints: true, totalStatus: true, measuredAt: true },
  });
}
