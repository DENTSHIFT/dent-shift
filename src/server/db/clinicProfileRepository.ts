import "server-only";
import { prisma } from "./prismaClient";
import { recordClinicAuditLog } from "./clinicAuditLogRepository";
import {
  changedClinicProfileFields,
  type ClinicProfileField,
  type ClinicProfileValues,
} from "@/domain/clinic/clinicProfile";

const PROFILE_SELECT = {
  name: true,
  directorName: true,
  url: true,
  gbpUrl: true,
  bookingUrl: true,
  contactPhone: true,
} as const;

export async function getClinicProfile(clinicId: string) {
  return prisma.clinic.findUnique({ where: { id: clinicId }, select: PROFILE_SELECT });
}

/**
 * 医院情報を更新する。clinicIdは必ずログイン中のContactから渡す(他医院は更新できない)。
 * 監査ログには変更した項目名だけを残し、値(電話番号等)は残さない。
 */
export async function updateClinicProfile(input: {
  clinicId: string;
  contactId: string;
  values: ClinicProfileValues;
}): Promise<{ changed: ClinicProfileField[] } | null> {
  return prisma.$transaction(async (tx) => {
    const before = await tx.clinic.findUnique({ where: { id: input.clinicId }, select: PROFILE_SELECT });
    if (!before) return null;
    const changed = changedClinicProfileFields(before, input.values);
    if (changed.length === 0) return { changed };
    await tx.clinic.update({ where: { id: input.clinicId }, data: input.values });
    await recordClinicAuditLog(tx, {
      clinicId: input.clinicId,
      contactId: input.contactId,
      action: "clinic_profile_updated",
      targetType: "Clinic",
      targetId: input.clinicId,
      metadata: { fields: changed },
    });
    return { changed };
  });
}
