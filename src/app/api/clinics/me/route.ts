import { NextRequest, NextResponse } from "next/server";
import { getCurrentContact } from "@/server/auth/session";
import { validateClinicProfileInput } from "@/domain/clinic/clinicProfile";
import { updateClinicProfile } from "@/server/db/clinicProfileRepository";

// ログイン中のContactが属する医院(clinicId)の情報だけを更新する。リクエストにclinicIdは受け付けない。
export async function PATCH(request: NextRequest) {
  const contact = await getCurrentContact();
  if (!contact) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });

  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "リクエストが不正です。" }, { status: 400 });
  }

  const validation = validateClinicProfileInput(body);
  if (!validation.ok) {
    return NextResponse.json(
      { error: "入力内容を確認してください。", fieldErrors: validation.errors },
      { status: 400 }
    );
  }

  try {
    const result = await updateClinicProfile({
      clinicId: contact.clinicId,
      contactId: contact.id,
      values: validation.value,
    });
    if (!result) return NextResponse.json({ error: "医院情報が見つかりません。" }, { status: 404 });
    return NextResponse.json({ ok: true, changed: result.changed }, { status: 200 });
  } catch {
    console.error("[PATCH /api/clinics/me] update failed");
    return NextResponse.json(
      { error: "保存できませんでした。時間をおいて再度お試しください。" },
      { status: 500 }
    );
  }
}
