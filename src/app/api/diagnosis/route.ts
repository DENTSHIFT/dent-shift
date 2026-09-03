import { NextRequest, NextResponse } from "next/server";
import { runFreeDiagnosis, InvalidDiagnosisInputError } from "@/server/services/runFreeDiagnosis";
import { MockAiProvider } from "@/server/providers/ai/mockAiProvider";
import { MockCompetitorProvider } from "@/server/providers/competitor/mockCompetitorProvider";
import { saveDiagnosisResult } from "@/server/db/diagnosisRepository";

const aiProvider = new MockAiProvider();
const competitorProvider = new MockCompetitorProvider();

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "リクエストボディがJSONとして解釈できません" }, { status: 400 });
  }

  const { clinicName, clinicUrl, contactEmail, gbpUrl, bookingUrl } = (body ?? {}) as Record<
    string,
    unknown
  >;

  try {
    const result = await runFreeDiagnosis(
      {
        clinicName: String(clinicName ?? ""),
        clinicUrl: String(clinicUrl ?? ""),
        contactEmail: String(contactEmail ?? ""),
        gbpUrl: gbpUrl ? String(gbpUrl) : undefined,
        bookingUrl: bookingUrl ? String(bookingUrl) : undefined,
      },
      { aiProvider, competitorProvider }
    );

    const saved = await saveDiagnosisResult(
      {
        clinicUrl: String(clinicUrl ?? ""),
        contactEmail: String(contactEmail ?? ""),
        gbpUrl: gbpUrl ? String(gbpUrl) : undefined,
        bookingUrl: bookingUrl ? String(bookingUrl) : undefined,
      },
      result
    );

    return NextResponse.json({ diagnosisId: saved.diagnosisId }, { status: 201 });
  } catch (err) {
    if (err instanceof InvalidDiagnosisInputError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[POST /api/diagnosis] unexpected error", err);
    return NextResponse.json(
      { error: "診断処理中にエラーが発生しました。時間をおいて再度お試しください。" },
      { status: 500 }
    );
  }
}
