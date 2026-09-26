import { describe, expect, it } from "vitest";
import { canCheckSmsCode, decideSmsSend, isSmsResetEligible, type SmsResetContactState } from "@/domain/auth/passwordReset";

const now = new Date("2026-09-26T12:00:00Z");
const base: SmsResetContactState = {
  phoneNumber: "+819012345678",
  phoneVerifiedAt: new Date("2026-09-01T00:00:00Z"),
  passwordResetSmsSentAt: null,
  passwordResetSmsWindowStartedAt: null,
  passwordResetSmsSendCount: 0,
  passwordResetSmsAttemptCount: 0,
};

describe("isSmsResetEligible", () => {
  it("番号と認証済み日時の両方が必要", () => {
    expect(isSmsResetEligible(base)).toBe(true);
    expect(isSmsResetEligible({ ...base, phoneVerifiedAt: null })).toBe(false);
    expect(isSmsResetEligible({ ...base, phoneNumber: null })).toBe(false);
  });
});

describe("decideSmsSend", () => {
  it("初回は許可しカウントを1にする", () => {
    const d = decideSmsSend(base, now);
    expect(d).toMatchObject({ allowed: true, sendCount: 1 });
  });
  it("1分以内の再送は拒否", () => {
    expect(decideSmsSend({ ...base, passwordResetSmsSentAt: new Date(now.getTime() - 30_000) }, now).allowed).toBe(false);
  });
  it("窓内で5回送信済みなら拒否、窓が過ぎればリセット", () => {
    const sent = { ...base, passwordResetSmsSendCount: 5, passwordResetSmsSentAt: new Date(now.getTime() - 120_000) };
    expect(decideSmsSend({ ...sent, passwordResetSmsWindowStartedAt: new Date(now.getTime() - 600_000) }, now).allowed).toBe(false);
    expect(decideSmsSend({ ...sent, passwordResetSmsWindowStartedAt: new Date(now.getTime() - 2 * 3_600_000) }, now)).toMatchObject({ allowed: true, sendCount: 1 });
  });
  it("認証済み番号がなければ拒否", () => {
    expect(decideSmsSend({ ...base, phoneVerifiedAt: null }, now).allowed).toBe(false);
  });
});

describe("canCheckSmsCode", () => {
  const sent = { ...base, passwordResetSmsSentAt: new Date(now.getTime() - 60_000) };
  it("送信後10分以内・試行5回未満のみ可", () => {
    expect(canCheckSmsCode(sent, now)).toBe(true);
    expect(canCheckSmsCode({ ...sent, passwordResetSmsAttemptCount: 5 }, now)).toBe(false);
    expect(canCheckSmsCode({ ...sent, passwordResetSmsSentAt: new Date(now.getTime() - 11 * 60_000) }, now)).toBe(false);
    expect(canCheckSmsCode(base, now)).toBe(false);
  });
});
