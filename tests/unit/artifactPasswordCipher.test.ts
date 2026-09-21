import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import {
  encryptPasswordForStorage,
  decryptStoredPassword,
  ArtifactPasswordDecryptionError,
} from "@/server/crypto/artifactPasswordCipher";
import {
  resolveArtifactEncryptionConfig,
  ArtifactEncryptionConfigError,
} from "@/server/config/artifactEncryptionConfig";

const VALID_KEY_HEX = randomBytes(32).toString("hex");

describe("artifactPasswordCipher", () => {
  it("暗号化した値を同じ鍵で復号すると元のパスワードに戻る", () => {
    const config = resolveArtifactEncryptionConfig({
      env: { ARTIFACT_PASSWORD_ENC_KEY: VALID_KEY_HEX },
    });
    const stored = encryptPasswordForStorage("Ab3dEf9hJk2M", config);
    expect(stored).not.toContain("Ab3dEf9hJk2M");
    expect(decryptStoredPassword(stored, config)).toBe("Ab3dEf9hJk2M");
  });

  it("異なる鍵では復号に失敗する", () => {
    const config = resolveArtifactEncryptionConfig({
      env: { ARTIFACT_PASSWORD_ENC_KEY: VALID_KEY_HEX },
    });
    const stored = encryptPasswordForStorage("secret-pass", config);
    const otherConfig = resolveArtifactEncryptionConfig({
      env: { ARTIFACT_PASSWORD_ENC_KEY: randomBytes(32).toString("hex") },
    });
    expect(() => decryptStoredPassword(stored, otherConfig)).toThrow();
  });

  it("壊れた形式の値はArtifactPasswordDecryptionErrorになる", () => {
    const config = resolveArtifactEncryptionConfig({
      env: { ARTIFACT_PASSWORD_ENC_KEY: VALID_KEY_HEX },
    });
    expect(() => decryptStoredPassword("not-a-valid-format", config)).toThrow(
      ArtifactPasswordDecryptionError
    );
  });
});

describe("resolveArtifactEncryptionConfig", () => {
  it("未設定はArtifactEncryptionConfigError", () => {
    expect(() => resolveArtifactEncryptionConfig({ env: {} })).toThrow(
      ArtifactEncryptionConfigError
    );
  });

  it("32byte(64桁hex)でない値はArtifactEncryptionConfigError", () => {
    expect(() =>
      resolveArtifactEncryptionConfig({ env: { ARTIFACT_PASSWORD_ENC_KEY: "abcd" } })
    ).toThrow(ArtifactEncryptionConfigError);
  });
});
