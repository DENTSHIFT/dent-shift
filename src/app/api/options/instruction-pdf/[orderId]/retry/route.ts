import { NextRequest, NextResponse } from "next/server";
import { getCurrentContact } from "@/server/auth/session";
import { getOptionOrderById } from "@/server/db/optionOrderRepository";
import { generateInstructionPdfArtifact } from "@/server/services/optionOrders/generateInstructionPdfArtifact";

/**
 * 生成失敗(generation_failed)からの再試行。決済は既に完了しているため、Checkoutの
 * 再作成はしない(二重課金防止)。ユーザーが行き止まりにならないよう、障害系E2E
 * (2026-09-22のユーザー指示)で発見した欠落導線を補う。
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const currentContact = await getCurrentContact();
  if (!currentContact) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }

  const { orderId } = await params;
  const order = await getOptionOrderById(orderId);
  if (!order || order.clinicId !== currentContact.clinicId) {
    return NextResponse.json({ error: "指定された注文が見つかりません" }, { status: 404 });
  }
  if (order.status !== "generation_failed") {
    return NextResponse.json({ error: "この注文は再試行できません" }, { status: 409 });
  }

  try {
    await generateInstructionPdfArtifact(order.id);
  } catch (error) {
    // 生成自体の失敗は generateInstructionPdfArtifact 内で generation_failed へ
    // 記録済み(監査ログ・lastError含む)。ここでは再試行APIとして失敗を伝えるのみ。
    console.error(
      "[POST /api/options/instruction-pdf/[orderId]/retry] retry failed:",
      error instanceof Error ? error.message : "unknown error"
    );
    return NextResponse.json(
      { error: "再試行に失敗しました。時間をおいて再度お試しください。" },
      { status: 502 }
    );
  }

  return NextResponse.json({ status: "retried" }, { status: 200 });
}
