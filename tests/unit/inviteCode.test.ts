import { describe, expect, it } from "vitest";
import {
  computeInviteCancelAtEpochSeconds,
  generateInviteCode,
  validateInvite,
} from "@/domain/invite/inviteCode";

describe("generateInviteCode", () => {
  it("26文字で、毎回異なる値を生成する", () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateInviteCode()));
    for (const code of codes) {
      expect(code).toHaveLength(26);
      expect(code).toMatch(/^[A-Za-z0-9]+$/);
    }
    expect(codes.size).toBe(50);
  });
});

const BASE = {
  status: "active",
  startsAt: new Date("2026-09-01T00:00:00Z"),
  expiresAt: null as Date | null,
  maxUses: 1,
  usedCount: 0,
};

describe("validateInvite", () => {
  it("有効な招待はvalid:true", () => {
    expect(validateInvite(BASE, new Date("2026-09-22T00:00:00Z"))).toEqual({ valid: true });
  });

  it("statusがactive以外はnot_active", () => {
    expect(validateInvite({ ...BASE, status: "revoked" })).toEqual({
      valid: false,
      reason: "not_active",
    });
  });

  it("開始前はnot_started", () => {
    expect(
      validateInvite(BASE, new Date("2026-08-31T00:00:00Z"))
    ).toEqual({ valid: false, reason: "not_started" });
  });

  it("期限切れはexpired", () => {
    expect(
      validateInvite(
        { ...BASE, expiresAt: new Date("2026-09-10T00:00:00Z") },
        new Date("2026-09-22T00:00:00Z")
      )
    ).toEqual({ valid: false, reason: "expired" });
  });

  it("使用回数上限に達している場合はexhausted", () => {
    expect(validateInvite({ ...BASE, usedCount: 1, maxUses: 1 })).toEqual({
      valid: false,
      reason: "exhausted",
    });
  });
});

describe("computeInviteCancelAtEpochSeconds", () => {
  it("開始日時からdurationMonths後のUNIX秒を返す(3か月後に自動終了)", () => {
    const startedAt = new Date("2026-09-22T01:00:00Z");
    const epoch = computeInviteCancelAtEpochSeconds(startedAt, 3);
    const expected = Math.floor(new Date("2026-12-22T01:00:00Z").getTime() / 1000);
    expect(epoch).toBe(expected);
  });
});
