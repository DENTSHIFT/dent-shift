import { describe, expect, it } from "vitest";
import {
  generateEmailVerificationToken,
  hashEmailVerificationToken,
  EMAIL_VERIFICATION_TTL_MS,
} from "@/server/auth/emailVerificationToken";

describe("emailVerificationToken", () => {
  it("生成したトークンは十分な長さのランダム値である", () => {
    const { token } = generateEmailVerificationToken();
    expect(token.length).toBeGreaterThanOrEqual(32);
  });

  it("同一トークンは常に同一ハッシュへ写像される(検証時の突き合わせに使うため)", () => {
    const { token, tokenHash } = generateEmailVerificationToken();
    expect(hashEmailVerificationToken(token)).toBe(tokenHash);
  });

  it("異なるトークンは異なるハッシュになる", () => {
    const a = generateEmailVerificationToken();
    const b = generateEmailVerificationToken();
    expect(a.tokenHash).not.toBe(b.tokenHash);
  });

  it("有効期限は24時間後に設定される", () => {
    const before = Date.now();
    const { expiresAt } = generateEmailVerificationToken();
    expect(expiresAt.getTime() - before).toBeGreaterThanOrEqual(EMAIL_VERIFICATION_TTL_MS - 1000);
    expect(expiresAt.getTime() - before).toBeLessThanOrEqual(EMAIL_VERIFICATION_TTL_MS + 1000);
  });

  it("平文トークンはハッシュ値と異なる(平文がそのまま保存されないことの確認)", () => {
    const { token, tokenHash } = generateEmailVerificationToken();
    expect(tokenHash).not.toBe(token);
  });
});
