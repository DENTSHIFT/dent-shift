import { NextRequest, NextResponse } from "next/server";
import { getCurrentOperator } from "@/server/auth/operatorSession";
import { recordAuditLog } from "@/server/db/auditLogRepository";
import { resendDiagnosisResultEmailForOps } from "@/server/services/resendDiagnosisResultEmailForOps";

/**
 * ops専用(2026-09-24): 診断結果メールの送信に失敗した1件を手動で再送する。
 * 診断本体・AI計測・課金には一切触れず、保存済みDiagnosisから同じテンプレートで
 * メールを送り直すだけ。既存の/api/ops配下と同じOperatorセッション認証のみを使う。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const operator = await getCurrentOperator();
  if (!operator) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }

  const { id } = await params;
  const outcome = await resendDiagnosisResultEmailForOps(id);

  await recordAuditLog({
    operatorId: operator.id,
    action: "ops_resend_diagnosis_result_email",
    targetType: "Diagnosis",
    targetId: id,
    metadata: { outcome },
  }).catch((error) => {
    console.error("[POST /api/ops/diagnosis-result-emails/[id]/resend] audit log recording failed:", error);
  });

  if (outcome === "diagnosis_not_found") {
    return NextResponse.json({ error: "対象の診断が見つかりません" }, { status: 404 });
  }
  if (outcome === "no_recipient_email") {
    return NextResponse.json(
      { error: "この医院には送信先メールアドレスが登録されていません" },
      { status: 409 }
    );
  }
  if (outcome === "disabled") {
    return NextResponse.json(
      { error: "メール送信基盤が無効化されています(RESULT_EMAIL_PROVIDER未設定)" },
      { status: 409 }
    );
  }
  if (outcome === "failed") {
    return NextResponse.json({ error: "メール送信に失敗しました。時間をおいて再度お試しください" }, { status: 502 });
  }

  return NextResponse.json({ status: outcome });
}
