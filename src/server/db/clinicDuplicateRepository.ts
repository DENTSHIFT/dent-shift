import { prisma } from "./prismaClient";
import {
  detectClinicDuplicateCandidate,
  type ClinicDuplicateCandidate,
} from "@/domain/clinic/duplicateDetection";

/**
 * P0の医院重複候補検出。Clinic件数が小さい段階ではURL正規化をアプリ側で行う。
 * 本番規模ではnormalized host列+indexへ移行するが、自動統合しない原則は維持する。
 */
export async function findClinicDuplicateCandidate(input: {
  clinicName: string;
  clinicUrl: string;
}): Promise<ClinicDuplicateCandidate | null> {
  const clinics = await prisma.clinic.findMany({
    select: { id: true, name: true, url: true },
  });
  return detectClinicDuplicateCandidate(input, clinics);
}
