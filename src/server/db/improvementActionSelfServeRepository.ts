import "server-only";
import { prisma } from "./prismaClient";

/**
 * ①自院で対応: 決済も生成も伴わない単純な意思表示。取り消し可能な2値(マークされて
 * いるか否か)のみを持つ。同一reportId×version×keyの重複マークはupsertで冪等にする。
 */
export async function markImprovementActionSelfServe(input: {
  clinicId: string;
  contactId: string | null;
  reportId: string;
  version: number;
  improvementActionKey: string;
}) {
  return prisma.improvementActionSelfServeMark.upsert({
    where: {
      reportId_version_improvementActionKey: {
        reportId: input.reportId,
        version: input.version,
        improvementActionKey: input.improvementActionKey,
      },
    },
    create: {
      clinicId: input.clinicId,
      contactId: input.contactId,
      reportId: input.reportId,
      version: input.version,
      improvementActionKey: input.improvementActionKey,
    },
    update: {},
  });
}

export async function unmarkImprovementActionSelfServe(input: {
  reportId: string;
  version: number;
  improvementActionKey: string;
}) {
  await prisma.improvementActionSelfServeMark.deleteMany({
    where: {
      reportId: input.reportId,
      version: input.version,
      improvementActionKey: input.improvementActionKey,
    },
  });
}

export async function getSelfServeMarksForReport(input: { reportId: string; version: number }) {
  const rows = await prisma.improvementActionSelfServeMark.findMany({
    where: { reportId: input.reportId, version: input.version },
    select: { improvementActionKey: true, markedAt: true },
  });
  return new Map(rows.map((row) => [row.improvementActionKey, row.markedAt]));
}
