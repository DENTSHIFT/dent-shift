import { NextRequest, NextResponse } from "next/server";
import { getCurrentContact } from "@/server/auth/session";
import { activatePilotInvite, PilotInviteError } from "@/server/services/invites/activatePilotInvite";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const currentContact = await getCurrentContact();
  if (!currentContact) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }

  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403 });
  }

  const { code } = await params;

  try {
    const result = await activatePilotInvite({
      inviteCode: code,
      clinicId: currentContact.clinicId,
      contactEmail: currentContact.email,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof PilotInviteError) {
      const status =
        error.code === "disabled"
          ? 404
          : error.code === "not_found"
            ? 404
            : error.code === "email_mismatch"
              ? 403
              : 409;
      return NextResponse.json({ error: error.message }, { status });
    }
    console.error(
      "[POST /api/invites/[code]/pilot-activate] unexpected error:",
      error instanceof Error ? error.name : "UnknownError"
    );
    return NextResponse.json(
      { error: "手続き中にエラーが発生しました。時間をおいて再度お試しください。" },
      { status: 500 }
    );
  }
}
