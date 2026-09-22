import { NextRequest, NextResponse } from "next/server";
import { getCurrentContact } from "@/server/auth/session";
import { prisma } from "@/server/db/prismaClient";
import {
  markImprovementActionSelfServe,
  unmarkImprovementActionSelfServe,
} from "@/server/db/improvementActionSelfServeRepository";
import { recordClinicAuditLog } from "@/server/db/clinicAuditLogRepository";

async function parseAndAuthorize(request: NextRequest) {
  const currentContact = await getCurrentContact();
  if (!currentContact) {
    return { error: NextResponse.json({ error: "ログインが必要です" }, { status: 401 }) } as const;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return {
      error: NextResponse.json({ error: "リクエストボディがJSONとして解釈できません" }, { status: 400 }),
    } as const;
  }
  const { reportId, improvementActionKey } = (body ?? {}) as Record<string, unknown>;
  if (typeof reportId !== "string" || !reportId) {
    return { error: NextResponse.json({ error: "reportIdは必須です" }, { status: 400 }) } as const;
  }
  if (typeof improvementActionKey !== "string" || !improvementActionKey) {
    return {
      error: NextResponse.json({ error: "improvementActionKeyは必須です" }, { status: 400 }),
    } as const;
  }

  // reportId(診断)が自院のものであることを必ず確認する(他clinicの診断IDを渡されても
  // マークを作らせない。instruction-pdf/checkoutと同じ所有者チェック原則)。
  const diagnosis = await prisma.diagnosis.findFirst({
    where: { id: reportId, clinicId: currentContact.clinicId },
    select: { id: true },
  });
  if (!diagnosis) {
    return {
      error: NextResponse.json({ error: "指定された診断結果が見つかりません" }, { status: 404 }),
    } as const;
  }

  return { currentContact, reportId, improvementActionKey } as const;
}

export async function POST(request: NextRequest) {
  const result = await parseAndAuthorize(request);
  if ("error" in result) return result.error;
  const { currentContact, reportId, improvementActionKey } = result;

  await markImprovementActionSelfServe({
    clinicId: currentContact.clinicId,
    contactId: currentContact.id,
    reportId,
    version: 1,
    improvementActionKey,
  });
  await recordClinicAuditLog(prisma, {
    clinicId: currentContact.clinicId,
    contactId: currentContact.id,
    action: "improvement_action_self_serve_marked",
    targetType: "Diagnosis",
    targetId: reportId,
    metadata: { improvementActionKey },
  });

  return NextResponse.json({ marked: true }, { status: 200 });
}

export async function DELETE(request: NextRequest) {
  const result = await parseAndAuthorize(request);
  if ("error" in result) return result.error;
  const { currentContact, reportId, improvementActionKey } = result;

  await unmarkImprovementActionSelfServe({ reportId, version: 1, improvementActionKey });
  await recordClinicAuditLog(prisma, {
    clinicId: currentContact.clinicId,
    contactId: currentContact.id,
    action: "improvement_action_self_serve_unmarked",
    targetType: "Diagnosis",
    targetId: reportId,
    metadata: { improvementActionKey },
  });

  return NextResponse.json({ marked: false }, { status: 200 });
}
