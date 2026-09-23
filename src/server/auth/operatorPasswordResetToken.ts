import { randomBytes, createHash } from "node:crypto";

// emailVerificationToken.tsと同型: 32バイトのランダム値自体が強度を持つため、
// sha256で十分。平文トークンはDB・ログに一切保存しない。
const TOKEN_BYTES = 32;
export const OPERATOR_PASSWORD_RESET_TTL_MS = 1000 * 60 * 60; // 1時間

export interface GeneratedOperatorPasswordResetToken {
  token: string;
  tokenHash: string;
  expiresAt: Date;
}

export function generateOperatorPasswordResetToken(): GeneratedOperatorPasswordResetToken {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  return {
    token,
    tokenHash: hashOperatorPasswordResetToken(token),
    expiresAt: new Date(Date.now() + OPERATOR_PASSWORD_RESET_TTL_MS),
  };
}

export function hashOperatorPasswordResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
