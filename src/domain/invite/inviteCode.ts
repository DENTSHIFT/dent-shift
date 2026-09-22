import { randomBytes } from "node:crypto";

// 数字/大文字/小文字を含む十分なエントロピーの招待コード(26文字、base62相当)。
// 推測困難性を優先し、連番・日付等の規則性は一切持たせない。
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const CODE_LENGTH = 26;

export function generateInviteCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return code;
}

export type InviteStatus = "active" | "used" | "expired" | "revoked";

export interface InviteValidationInput {
  status: string;
  startsAt: Date;
  expiresAt: Date | null;
  maxUses: number;
  usedCount: number;
}

export type InviteValidationResult =
  | { valid: true }
  | { valid: false; reason: "not_active" | "not_started" | "expired" | "exhausted" };

/**
 * 招待URLの有効性を判定する純粋関数(DBアクセスなし)。
 * 「期限切れURLは利用不可」「使用回数制限」を機械的に判定する。
 */
export function validateInvite(
  invite: InviteValidationInput,
  now: Date = new Date()
): InviteValidationResult {
  if (invite.status !== "active") return { valid: false, reason: "not_active" };
  if (invite.startsAt.getTime() > now.getTime()) return { valid: false, reason: "not_started" };
  if (invite.expiresAt && invite.expiresAt.getTime() < now.getTime()) {
    return { valid: false, reason: "expired" };
  }
  if (invite.usedCount >= invite.maxUses) return { valid: false, reason: "exhausted" };
  return { valid: true };
}

/** Stripe subscription_data[cancel_at]用の絶対タイムスタンプ(UNIX seconds)。 */
export function computeInviteCancelAtEpochSeconds(startedAt: Date, durationMonths: number): number {
  const cancelAt = new Date(startedAt);
  cancelAt.setUTCMonth(cancelAt.getUTCMonth() + durationMonths);
  return Math.floor(cancelAt.getTime() / 1000);
}
