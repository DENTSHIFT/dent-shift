import { NextRequest, NextResponse } from "next/server";
import { verifyEmailToken } from "@/server/services/verifyEmailToken";

/**
 * メール本文中のリンク(GET)からの確認を受け付けるAPI。
 * 2026-09-24: 検証処理本体はverifyEmailToken()へ切り出し済み。
 * このルートはJSON APIとしての契約(既存の呼び出し元向け)を保つためだけに残す。
 * 実際にメール内リンクが遷移する先はUI画面の/verify-emailページ
 * (src/app/verify-email/page.tsx、同じverifyEmailToken()を直接呼ぶ)。
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "確認トークンが指定されていません" }, { status: 400 });
  }

  const result = await verifyEmailToken(token);
  if (result.status === "error") {
    return NextResponse.json(
      { error: result.message, ...(result.code === "expired" ? { code: result.code } : {}) },
      { status: 400 }
    );
  }
  return NextResponse.json({ status: result.status }, { status: 200 });
}
