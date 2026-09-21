import "server-only";

export class ArtifactEncryptionConfigError extends Error {}

export interface ArtifactEncryptionConfig {
  /** AES-256-GCM鍵(32byte)。生成PDFの閲覧パスワードを再表示用に可逆暗号化する。 */
  key: Buffer;
}

/**
 * GeneratedArtifact.passwordEncrypted(ダッシュボード「パスワードを表示」用の可逆暗号化)
 * に使う鍵を環境変数から取得する。鍵自体はDBへ一切保存しない。
 * billingConfig.ts等と同じ「未設定なら明示エラー、silent fallbackしない」方針を踏襲する。
 */
export function resolveArtifactEncryptionConfig(options: {
  env: Record<string, string | undefined>;
}): ArtifactEncryptionConfig {
  const raw = options.env.ARTIFACT_PASSWORD_ENC_KEY?.trim();
  if (!raw) {
    throw new ArtifactEncryptionConfigError(
      "ARTIFACT_PASSWORD_ENC_KEY is required to store/reveal generated artifact passwords."
    );
  }
  const key = Buffer.from(raw, "hex");
  if (key.length !== 32) {
    throw new ArtifactEncryptionConfigError(
      "ARTIFACT_PASSWORD_ENC_KEY must be a 32-byte value encoded as 64 hex characters."
    );
  }
  return { key };
}

export function resolveArtifactEncryptionConfigFromProcessEnv(): ArtifactEncryptionConfig {
  return resolveArtifactEncryptionConfig({ env: process.env });
}
