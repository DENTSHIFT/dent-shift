import { randomBytes, createHash } from "node:crypto";

const TOKEN_BYTES = 32;
export const CONTACT_PASSWORD_RESET_TTL_MS = 30 * 60_000;

export function generateContactPasswordResetToken() {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  return {
    token,
    tokenHash: hashContactPasswordResetToken(token),
    expiresAt: new Date(Date.now() + CONTACT_PASSWORD_RESET_TTL_MS),
  };
}

export function hashContactPasswordResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
