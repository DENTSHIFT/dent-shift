import "server-only";
import { prisma } from "@/server/db/prismaClient";
import { getOptionOrderById } from "@/server/db/optionOrderRepository";
import {
  ensureArtifactForOrder,
  markArtifactFailed,
  markArtifactGenerated,
  markArtifactGenerating,
} from "@/server/db/generatedArtifactRepository";
import { recordClinicAuditLog } from "@/server/db/clinicAuditLogRepository";
import { canTransitionOptionOrderStatus, type OptionOrderStatus } from "@/domain/options/optionOrderStatus";
import { buildInstructionPdfDocument } from "@/server/pdf/instructionPdfDocument";
import { protectPdfWithPassword } from "@/server/pdf/pdfPasswordProtection";
import { generateInstructionPdfPassword } from "@/domain/options/pdfPassword";
import { hashPassword } from "@/server/auth/password";
import { encryptPasswordForStorage } from "@/server/crypto/artifactPasswordCipher";
import { resolveArtifactEncryptionConfigFromProcessEnv } from "@/server/config/artifactEncryptionConfig";

export class InstructionPdfArtifactError extends Error {}

async function transitionOrderStatus(orderId: string, to: OptionOrderStatus) {
  const order = await prisma.optionOrder.findUnique({ where: { id: orderId } });
  if (!order) throw new InstructionPdfArtifactError("Option order not found.");
  if (order.status === to) return;
  if (!canTransitionOptionOrderStatus(order.status as OptionOrderStatus, to)) {
    throw new InstructionPdfArtifactError(
      `Cannot transition option order from ${order.status} to ${to}.`
    );
  }
  await prisma.optionOrder.update({ where: { id: orderId }, data: { status: to } });
}

/**
 * 決済(または無料枠消費)済みの注文から、制作会社向け修正指示書PDFを生成する。
 * Phase4前半はモック内容で固定し(実データ差し込みは後続)、以下を必ず行う:
 * - パスワードはランダム生成し、PDF自体をパスワード保護(pdfPasswordProtection.ts)
 * - passwordHash(照合用/一方向)とpasswordEncrypted(再表示用/可逆)を分離して保存
 * - 暗号鍵自体はDBへ保存しない(ARTIFACT_PASSWORD_ENC_KEY環境変数)
 * - 生成成功・失敗をClinicAuditLogへ記録
 *
 * 決済前(draft/checkout_created等)の注文は呼び出し元(Webhook適用後のみ起動)で
 * 弾かれる前提だが、二重の安全策としてここでも状態遷移の妥当性チェックで弾く。
 */
export async function generateInstructionPdfArtifact(orderId: string): Promise<void> {
  const order = await getOptionOrderById(orderId);
  if (!order) throw new InstructionPdfArtifactError("Option order not found.");
  if (order.status !== "generation_queued") {
    // 既に生成済み・生成中の再送、または不正な状態からの呼び出しは何もしない(冪等)。
    return;
  }

  const clinic = await prisma.clinic.findUnique({ where: { id: order.clinicId } });
  if (!clinic) throw new InstructionPdfArtifactError("Clinic not found for option order.");

  await ensureArtifactForOrder(prisma, {
    orderId: order.id,
    clinicId: order.clinicId,
    type: "instruction_pdf",
    reportId: order.reportId,
    version: order.version,
  });
  await markArtifactGenerating(order.id);
  await transitionOrderStatus(order.id, "generating");

  try {
    const encryptionConfig = resolveArtifactEncryptionConfigFromProcessEnv();

    // Phase4前半: モック内容(実データ差し込みは後続フェーズ)。患者個人情報は
    // このホワイトリスト構造に一切含めない。
    const pdfBytes = await buildInstructionPdfDocument({
      clinicName: clinic.name,
      reportVersion: order.version,
      generatedAt: new Date(),
      improvementItems: [
        {
          title: "予約導線の改善(モック項目1)",
          detail: "トップページの予約ボタン配置を見直し、離脱率を低減する。",
        },
        {
          title: "AI Overviews対応(モック項目2)",
          detail: "主要施術ページの構造化データを追加し、AI検索での露出を改善する。",
        },
      ],
    });

    const password = generateInstructionPdfPassword();
    const protectedPdf = await protectPdfWithPassword(pdfBytes, password);
    const passwordHash = await hashPassword(password);
    const passwordEncrypted = encryptPasswordForStorage(password, encryptionConfig);

    await markArtifactGenerated({
      orderId: order.id,
      fileData: protectedPdf,
      passwordHash,
      passwordEncrypted,
    });
    await transitionOrderStatus(order.id, "generated");
    await transitionOrderStatus(order.id, "available");

    await recordClinicAuditLog(prisma, {
      clinicId: order.clinicId,
      contactId: order.contactId,
      action: "artifact_generated",
      targetType: "OptionOrder",
      targetId: order.id,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    await markArtifactFailed(order.id, message);
    await transitionOrderStatus(order.id, "generation_failed");
    await recordClinicAuditLog(prisma, {
      clinicId: order.clinicId,
      contactId: order.contactId,
      action: "artifact_generation_failed",
      targetType: "OptionOrder",
      targetId: order.id,
    });
    throw error;
  }
}
