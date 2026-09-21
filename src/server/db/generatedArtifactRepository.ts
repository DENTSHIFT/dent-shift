import "server-only";
import { prisma } from "./prismaClient";
import type { Prisma } from "@prisma/client";

export class GeneratedArtifactRepositoryStateError extends Error {}

/**
 * OptionOrderにつき1件のGeneratedArtifactを冪等に用意する(orderId一意制約)。
 * 生成失敗からの再試行(regenerate)でも新しい行を増やさず、同じ行を使い回す。
 */
export async function ensureArtifactForOrder(
  client: Prisma.TransactionClient | typeof prisma,
  input: { orderId: string; clinicId: string; type: string; reportId: string; version: number }
) {
  const existing = await client.generatedArtifact.findUnique({ where: { orderId: input.orderId } });
  if (existing) return existing;
  return client.generatedArtifact.create({
    data: {
      orderId: input.orderId,
      clinicId: input.clinicId,
      type: input.type,
      reportId: input.reportId,
      version: input.version,
      generationStatus: "pending",
    },
  });
}

export async function markArtifactGenerating(orderId: string) {
  return prisma.generatedArtifact.update({
    where: { orderId },
    data: { generationStatus: "generating", lastError: null },
  });
}

export async function markArtifactGenerated(input: {
  orderId: string;
  fileData: Buffer;
  passwordHash: string;
  passwordEncrypted: string;
}) {
  return prisma.generatedArtifact.update({
    where: { orderId: input.orderId },
    data: {
      generationStatus: "generated",
      fileData: input.fileData,
      passwordHash: input.passwordHash,
      passwordEncrypted: input.passwordEncrypted,
      generatedAt: new Date(),
      lastError: null,
    },
  });
}

export async function markArtifactFailed(orderId: string, errorMessage: string) {
  return prisma.generatedArtifact.update({
    where: { orderId },
    data: { generationStatus: "failed", lastError: errorMessage.slice(0, 500) },
  });
}

export async function getArtifactByOrderId(orderId: string) {
  return prisma.generatedArtifact.findUnique({ where: { orderId } });
}

export async function markArtifactDownloaded(orderId: string) {
  return prisma.generatedArtifact.update({
    where: { orderId },
    data: { downloadedAt: new Date() },
  });
}
