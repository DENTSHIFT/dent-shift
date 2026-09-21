import { NextRequest, NextResponse } from "next/server";
import { getCurrentContact } from "@/server/auth/session";
import { getOptionOrderById } from "@/server/db/optionOrderRepository";
import { getArtifactByOrderId } from "@/server/db/generatedArtifactRepository";
import { recordClinicAuditLog } from "@/server/db/clinicAuditLogRepository";
import { prisma } from "@/server/db/prismaClient";
import {
  decryptStoredPassword,
  ArtifactPasswordDecryptionError,
} from "@/server/crypto/artifactPasswordCipher";
import {
  resolveArtifactEncryptionConfigFromProcessEnv,
  ArtifactEncryptionConfigError,
} from "@/server/config/artifactEncryptionConfig";

/**
 * ダッシュボード「パスワードを表示」用。passwordEncrypted(アプリ鍵で可逆暗号化された値)
 * を復号して平文パスワードを返す。photoHash側(照合用)はここでは使わない。
 * 表示のたびにClinicAuditLogへ記録する(誰がいつ見たかの追跡)。
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
  if (!artifact || artifact.generationStatus !== "generated" || !artifact.passwordEncrypted) {
    return NextResponse.json({ error: "パスワードはまだ発行されていません" }, { status: 409 });
  }

  let config;
  try {
    config = resolveArtifactEncryptionConfigFromProcessEnv();
  } catch (error) {
    if (error instanceof ArtifactEncryptionConfigError) {
      console.error("[GET /api/options/instruction-pdf/[orderId]/password] config error");
      return NextResponse.json({ error: "現在この機能は利用できません。" }, { status: 503 });
    }
    throw error;
  }

  let password: string;
  try {
    password = decryptStoredPassword(artifact.passwordEncrypted, config);
  } catch (error) {
    if (error instanceof ArtifactPasswordDecryptionError) {
      console.error("[GET /api/options/instruction-pdf/[orderId]/password] decryption error");
      return NextResponse.json({ error: "パスワードを復元できませんでした" }, { status: 500 });
    }
    throw error;
  }

  await recordClinicAuditLog(prisma, {
    clinicId: currentContact.clinicId,
    contactId: currentContact.id,
    action: "artifact_password_revealed",
    targetType: "OptionOrder",
    targetId: order.id,
  });

  return NextResponse.json({ password });
}
