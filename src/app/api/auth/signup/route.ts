import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db/prismaClient";
import { hashPassword } from "@/server/auth/password";
import { createSession, setSessionCookie } from "@/server/auth/session";
import { findClinicDuplicateCandidate } from "@/server/db/clinicDuplicateRepository";
import { duplicateCandidateMessage } from "@/domain/clinic/duplicateDetection";
import { sendEmailVerification } from "@/server/services/sendEmailVerification";
import { enqueueIntegrationEvent } from "@/server/db/integrationEventRepository";
import { normalizeReferralCode, ReferralCodeFormatError } from "@/domain/ambassador/referralCode";
import { findAmbassadorByReferralCode, recordPendingAttribution } from "@/server/db/ambassadorRepository";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Step4: 無料会員登録。
 * - clinicId が渡された場合: 無料診断済みの既存Clinicにこのアカウントを紐づける
 * - 渡されない場合: 医院名+URLで新規Clinicを作成してから紐づける
 * 電話番号は一切要求しない(引き継ぎ書3章-4)。
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "リクエストボディがJSONとして解釈できません" }, { status: 400 });
  }

  const { email, password, clinicId, clinicName, clinicUrl, referralCode } = (body ?? {}) as Record<
    string,
    unknown
  >;

  if (typeof email !== "string" || !EMAIL_RE.test(email.trim())) {
    return NextResponse.json({ error: "メールアドレスの形式が正しくありません" }, { status: 400 });
  }
  if (typeof password !== "string" || password.length < 8) {
    return NextResponse.json({ error: "パスワードは8文字以上で入力してください" }, { status: 400 });
  }
  if (clinicId !== undefined && (typeof clinicId !== "string" || !clinicId)) {
    return NextResponse.json({ error: "clinicIdの形式が不正です" }, { status: 400 });
  }

  // 紹介コードは任意入力。不正な形式でも登録自体は失敗させず、単に紐付けをスキップする
  // (Step8は仮仕様のため、登録フロー本体をブロックしない)。
  let normalizedReferralCode: string | null = null;
  if (typeof referralCode === "string" && referralCode.trim()) {
    try {
      normalizedReferralCode = normalizeReferralCode(referralCode);
    } catch (error) {
      if (!(error instanceof ReferralCodeFormatError)) throw error;
    }
  }

  const normalizedEmail = email.trim();
  const existing = await prisma.contact.findUnique({ where: { email: normalizedEmail } });
  if (existing) {
    return NextResponse.json({ error: "このメールアドレスは既に登録されています" }, { status: 409 });
  }

  let resolvedClinicId: string;

  if (typeof clinicId === "string" && clinicId) {
    const clinic = await prisma.clinic.findUnique({ where: { id: clinicId } });
    if (!clinic) {
      return NextResponse.json({ error: "指定された医院が見つかりません" }, { status: 404 });
    }
    resolvedClinicId = clinic.id;
  } else {
    if (typeof clinicName !== "string" || !clinicName.trim()) {
      return NextResponse.json({ error: "医院名は必須です" }, { status: 400 });
    }
    if (typeof clinicUrl !== "string" || !/^https?:\/\//.test(clinicUrl.trim())) {
      return NextResponse.json(
        { error: "公式サイトURLは http(s):// から始まる形式で入力してください" },
        { status: 400 }
      );
    }
    const duplicateCandidate = await findClinicDuplicateCandidate({
      clinicName: clinicName.trim(),
      clinicUrl: clinicUrl.trim(),
    });
    if (duplicateCandidate) {
      return NextResponse.json(
        {
          error: duplicateCandidateMessage(duplicateCandidate.matchType),
          code: "clinic_duplicate_candidate",
          matchType: duplicateCandidate.matchType,
        },
        { status: 409 }
      );
    }
    const clinic = await prisma.clinic.create({
      data: {
        name: clinicName.trim(),
        url: clinicUrl.trim(),
        contactEmail: normalizedEmail,
      },
    });
    resolvedClinicId = clinic.id;
  }

  const passwordHash = await hashPassword(password);
  const contact = await prisma.contact.create({
    data: {
      email: normalizedEmail,
      passwordHash,
      clinicId: resolvedClinicId,
      role: "owner",
      // sms→email→payment→consentの順で進む(registrationStep.ts参照)。
      // 電話番号は登録直後には未収集のため"sms"ステップから開始する。
      registrationStep: "sms",
    },
  });

  const token = await createSession(contact.id);
  await setSessionCookie(token);

  if (normalizedReferralCode) {
    const ambassador = await findAmbassadorByReferralCode(normalizedReferralCode);
    if (ambassador) {
      await recordPendingAttribution({ ambassadorId: ambassador.id, clinicId: resolvedClinicId }).catch(
        (error) => {
          console.error("[POST /api/auth/signup] attribution recording failed:", error);
        }
      );
    }
  }

  // メール確認・Salesforce同期は登録成功を阻害しない(外部サービス障害時も
  // 会員登録自体は完了させる、指示書18章「エラー設計」)。
  const clinic = await prisma.clinic.findUnique({ where: { id: resolvedClinicId } });
  await sendEmailVerification({
    contactId: contact.id,
    email: normalizedEmail,
    clinicName: clinic?.name ?? normalizedEmail,
  }).catch((error) => {
    console.error("[POST /api/auth/signup] email verification send failed:", error);
  });

  await enqueueIntegrationEvent({
    eventType: "trial_signup_started",
    clinicId: resolvedClinicId,
    contactId: contact.id,
    payload: {
      email: normalizedEmail,
      clinic_name: clinic?.name ?? null,
      registration_step: "sms",
    },
  }).catch((error) => {
    console.error("[POST /api/auth/signup] Salesforce sync enqueue failed:", error);
  });

  return NextResponse.json({ contactId: contact.id, clinicId: resolvedClinicId }, { status: 201 });
}
