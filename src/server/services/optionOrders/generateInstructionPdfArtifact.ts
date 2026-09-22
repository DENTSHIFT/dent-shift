import "server-only";
import { prisma } from "@/server/db/prismaClient";
import { getOptionOrderById } from "@/server/db/optionOrderRepository";
import { getDiagnosisById } from "@/server/db/diagnosisRepository";
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
import { getArtifactStorageAdapter } from "@/server/storage/dbBlobArtifactStorage";
import { NOT_AVAILABLE_LABEL } from "@/domain/options/instructionPdfContent";
import { mapImprovementCandidateToInstructionPdfItem } from "@/domain/options/instructionPdfContentMapper";
import type { ImprovementCandidate } from "@/domain/improvement-task/types";

export class InstructionPdfArtifactError extends Error {}

// テキストのみのA4文書であり通常は数十〜百数十KB程度に収まる。埋め込みフォント込みでも
// 十分な余裕を持たせつつ、異常に巨大なPDFがDB(Postgres Bytes列)へ保存されることを防ぐ
// (2026-09-22のユーザー指示)。
const MAX_PDF_BYTES = 8 * 1024 * 1024; // 8MB

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
 * 実データ差し込み(2026-09-22): order.improvementActionKeyでDiagnosis.topImprovementsから
 * 対象のImprovementCandidateを特定し、instructionPdfContentMapper.tsで14項目へ変換する。
 * 元データに存在しない項目(推奨文案/実装条件/完了条件/再診断条件)はAIで補完せず、
 * NOT_AVAILABLE_LABELをそのまま表示する。患者個人情報はDiagnosis/ImprovementCandidateの
 * どちらにも含まれないため(ドキュメント済みの前提)、ホワイトリスト方式のマッパーを
 * 経由する限り混入しない。
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

  const [clinic, diagnosis] = await Promise.all([
    prisma.clinic.findUnique({ where: { id: order.clinicId } }),
    getDiagnosisById(order.reportId),
  ]);
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

    const topImprovements = (diagnosis?.topImprovements ?? []) as ImprovementCandidate[];
    const targetTask = order.improvementActionKey
      ? topImprovements.find((task) => task.key === order.improvementActionKey)
      : undefined;

    const item = targetTask
      ? mapImprovementCandidateToInstructionPdfItem(targetTask)
      : {
          title: order.improvementActionKey
            ? NOT_AVAILABLE_LABEL // 指定されたキーが診断結果内に見つからない(不整合)
            : "改善項目未指定",
          currentProblem: NOT_AVAILABLE_LABEL,
          whyItMatters: NOT_AVAILABLE_LABEL,
          patientImpact: NOT_AVAILABLE_LABEL,
          fixSteps: NOT_AVAILABLE_LABEL,
          recommendedCopy: NOT_AVAILABLE_LABEL,
          implementationConditions: NOT_AVAILABLE_LABEL,
          recommendedAssignee: NOT_AVAILABLE_LABEL,
          priorityLabel: NOT_AVAILABLE_LABEL,
          completionCriteria: NOT_AVAILABLE_LABEL,
          remeasurementCriteria: NOT_AVAILABLE_LABEL,
        };

    const pdfBytes = await buildInstructionPdfDocument({
      clinicName: clinic.name,
      clinicUrl: diagnosis?.clinicUrl || NOT_AVAILABLE_LABEL,
      reportId: order.reportId,
      version: order.version,
      generatedAt: new Date(),
      item,
    });

    const password = generateInstructionPdfPassword();
    const protectedPdf = Buffer.from(await protectPdfWithPassword(pdfBytes, password));

    if (protectedPdf.byteLength > MAX_PDF_BYTES) {
      throw new InstructionPdfArtifactError(
        `Generated PDF exceeds the maximum allowed size (${protectedPdf.byteLength} > ${MAX_PDF_BYTES} bytes).`
      );
    }

    const storage = getArtifactStorageAdapter();
    const storageRef = await storage.save({ key: order.id, data: protectedPdf });

    const passwordHash = await hashPassword(password);
    const passwordEncrypted = encryptPasswordForStorage(password, encryptionConfig);

    await markArtifactGenerated({
      orderId: order.id,
      storageRef,
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
