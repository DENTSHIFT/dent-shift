import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db/prismaClient";
import { sendOperatorPasswordResetEmail } from "@/server/services/sendOperatorPasswordResetEmail";

// メールアドレスの存在有無を画面上で判別できないよう、成立・不成立に関わらず
// 常に同一のレスポンスを返す(ユーザー指示のセキュリティ要件)。
const GENERIC_MESSAGE =
  "ご入力いただいたメールアドレス宛に、パスワード再設定用のご案内をお送りしました(該当するアカウントが存在する場合のみ)。";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "リクエストボディがJSONとして解釈できません" }, { status: 400 });
  }
  const { email } = (body ?? {}) as Record<string, unknown>;
  if (typeof email !== "string" || !email.trim()) {
    return NextResponse.json({ error: "メールアドレスを入力してください" }, { status: 400 });
  }

  const operator = await prisma.operator.findUnique({ where: { email: email.trim() } });
  if (operator) {
    try {
      await sendOperatorPasswordResetEmail({ operatorId: operator.id, email: operator.email });
    } catch (error) {
      // 送信失敗の詳細(メール基盤のエラー等)は応答に含めない。存在有無を漏らさないため
      // 常に同一メッセージを返す。運用側の調査用にサーバーログへのみ記録する。
      console.error("[POST /api/ops/auth/forgot-password] email delivery failed:", error);
    }
  }

  return NextResponse.json({ message: GENERIC_MESSAGE }, { status: 200 });
}
