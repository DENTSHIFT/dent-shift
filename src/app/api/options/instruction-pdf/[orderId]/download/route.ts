import { NextRequest, NextResponse } from "next/server";
import { getCurrentContact } from "@/server/auth/session";
import { getOptionOrderById } from "@/server/db/optionOrderRepository";
import { getArtifactByOrderId, markArtifactDownloaded } from "@/server/db/generatedArtifactRepository";
import { recordClinicAuditLog } from "@/server/db/clinicAuditLogRepository";
import { prisma } from "@/server/db/prismaClient";

/**
 * 制作会社向け修正指示書PDFの認可付きダウンロード。
 * - 未認証は401、他clinicの注文は404(存在有無を漏らさない)。
 * - 決済(または無料枠消費)前の注文は取得不可。
 * - 恒久公開URLではなく、都度この認可チェックを通過した場合のみバイト列を返す。
 * - ダウンロードのたびにClinicAuditLogへ記録する(初回以降の再DLも含む)。
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

  const DOWNLOADABLE_STATUSES = new Set(["available", "downloaded", "completed"]);
  if (!DOWNLOADABLE_STATUSES.has(order.status)) {
    return NextResponse.json({ error: "この指示書はまだダウンロードできません" }, { status: 409 });
  }

  const artifact = await getArtifactByOrderId(order.id);
  if (!artifact || artifact.generationStatus !== "generated" || !artifact.fileData) {
    return NextResponse.json({ error: "この指示書はまだダウンロードできません" }, { status: 409 });
  }

  await markArtifactDownloaded(order.id);
  await recordClinicAuditLog(prisma, {
    clinicId: currentContact.clinicId,
    contactId: currentContact.id,
    action: "artifact_downloaded",
    targetType: "OptionOrder",
    targetId: order.id,
  });

  return new NextResponse(new Uint8Array(artifact.fileData), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="instruction-${order.reportId}-v${order.version}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
