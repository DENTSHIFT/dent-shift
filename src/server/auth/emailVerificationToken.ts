import { randomBytes, createHash } from "node:crypto";

// メール確認トークンはパスワードと異なり32バイトのランダム値そのものが強度を持つため、
// scryptのような低速ハッシュではなくsha256で十分(password.tsとは要件が異なる)。
// 平文トークンはDB・ログへ一切保存しない。
const TOKEN_BYTES = 32;
export const EMAIL_VERIFICATION_TTL_MS = 1000 * 60 * 60 * 24; // 24時間

export interface GeneratedEmailVerificationToken {
  token: string;
  tokenHash: string;
  expiresAt: Date;
}

export function generateEmailVerificationToken(): GeneratedEmailVerificationToken {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  return {
    token,
    tokenHash: hashEmailVerificationToken(token),
    expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS),
  };
}

export function hashEmailVerificationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
