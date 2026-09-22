import { NextRequest, NextResponse } from "next/server";
import { getCurrentContact } from "@/server/auth/session";
import { getOptionOrderById } from "@/server/db/optionOrderRepository";
import { getArtifactByOrderId } from "@/server/db/generatedArtifactRepository";

/**
 * ダッシュボード側のポーリング用。PDF本体やパスワードは一切返さず、
 * 「今どの状態か」だけを認可付きで返す(所有権チェックはdownload/password
 * エンドポイントと同じ)。
 */
export async function GET(
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

  const artifact = await getArtifactByOrderId(order.id);
  const DOWNLOADABLE_STATUSES = new Set(["available", "downloaded", "completed"]);
  const downloadable =
    DOWNLOADABLE_STATUSES.has(order.status) &&
    artifact?.generationStatus === "generated" &&
    Boolean(artifact.storageRef);

  return NextResponse.json({
    orderStatus: order.status,
    generationStatus: artifact?.generationStatus ?? null,
    downloadable,
    lastError: artifact?.lastError ?? null,
  });
}
