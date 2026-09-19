import { NextRequest, NextResponse } from "next/server";
import { getCurrentContact } from "@/server/auth/session";
import { findClinicDuplicateCandidate } from "@/server/db/clinicDuplicateRepository";
import { duplicateCandidateMessage } from "@/domain/clinic/duplicateDetection";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "リクエストボディがJSONとして解釈できません" }, { status: 400 });
  }

  const { clinicName, clinicUrl } = (body ?? {}) as Record<string, unknown>;
  if (typeof clinicName !== "string" || !clinicName.trim()) {
    return NextResponse.json({ error: "医院名は必須です" }, { status: 400 });
  }
  if (typeof clinicUrl !== "string" || !/^https?:\/\//.test(clinicUrl.trim())) {
    return NextResponse.json(
      { error: "公式サイトURLは http(s):// から始まる形式で入力してください" },
      { status: 400 }
    );
  }

  // ログイン中はセッションの医院へ再診断を追加するため、重複警告は不要。
  if (await getCurrentContact()) {
    return NextResponse.json({ duplicateCandidate: null });
  }

  const candidate = await findClinicDuplicateCandidate({
    clinicName: clinicName.trim(),
    clinicUrl: clinicUrl.trim(),
  });
  return NextResponse.json({
    duplicateCandidate: candidate
      ? {
          matchType: candidate.matchType,
          message: duplicateCandidateMessage(candidate.matchType),
        }
      : null,
  });
}
