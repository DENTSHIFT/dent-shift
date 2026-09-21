import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { ArtifactEncryptionConfig } from "@/server/config/artifactEncryptionConfig";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

/**
 * GeneratedArtifact.passwordEncrypted(ダッシュボード再表示用)の可逆暗号化。
 * 保存形式: "<ivHex>:<authTagHex>:<ciphertextHex>"。鍵はDBに保存せず、
 * 呼び出し側がArtifactEncryptionConfig(環境変数由来)を都度渡す。
 */
export function encryptPasswordForStorage(
  password: string,
  config: ArtifactEncryptionConfig
): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, config.key, iv);
  const ciphertext = Buffer.concat([cipher.update(password, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${ciphertext.toString("hex")}`;
}

export class ArtifactPasswordDecryptionError extends Error {}

export function decryptStoredPassword(
  stored: string,
  config: ArtifactEncryptionConfig
): string {
  const [ivHex, authTagHex, ciphertextHex] = stored.split(":");
  if (!ivHex || !authTagHex || !ciphertextHex) {
    throw new ArtifactPasswordDecryptionError("Stored password ciphertext is malformed.");
  }
  const decipher = createDecipheriv(ALGORITHM, config.key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextHex, "hex")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}
