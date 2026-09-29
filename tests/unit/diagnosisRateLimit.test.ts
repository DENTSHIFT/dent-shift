import { describe, expect, it } from "vitest";
import {
  evaluateDiagnosisRateLimitScope,
  combineDiagnosisRateLimitDecisions,
} from "@/domain/diagnosis/rateLimit";

const CONFIG = { windowMs: 10 * 60 * 1000, maxRequests: 3, enforceInFlightLock: true };
const TTL = 5 * 60 * 1000;

describe("evaluateDiagnosisRateLimitScope", () => {
  it("行が存在しない場合は新しい窓として許可する", () => {
    const now = new Date("2026-09-29T00:00:00.000Z");
    const result = evaluateDiagnosisRateLimitScope(null, CONFIG, TTL, now);
    expect(result).toEqual({
      allowed: true,
      nextState: { windowStartedAt: now, countInWindow: 1 },
    });
  });

  it("窓内で上限未満なら許可し、カウントを1つ進める", () => {
    const now = new Date("2026-09-29T00:05:00.000Z");
    const windowStartedAt = new Date("2026-09-29T00:00:00.000Z");
    const result = evaluateDiagnosisRateLimitScope(
      { windowStartedAt, countInWindow: 2, inFlightSince: null },
      CONFIG,
      TTL,
      now
    );
    expect(result).toEqual({
      allowed: true,
      nextState: { windowStartedAt, countInWindow: 3 },
    });
  });

  it("窓内で上限に達している場合はrate_limitedで拒否し、窓終了時刻をretryAtとする", () => {
    const now = new Date("2026-09-29T00:05:00.000Z");
    const windowStartedAt = new Date("2026-09-29T00:00:00.000Z");
    const result = evaluateDiagnosisRateLimitScope(
      { windowStartedAt, countInWindow: 3, inFlightSince: null },
      CONFIG,
      TTL,
      now
    );
    expect(result).toEqual({
      allowed: false,
      reason: "rate_limited",
      retryAt: new Date(windowStartedAt.getTime() + CONFIG.windowMs),
    });
  });

  it("窓の期限が切れていれば、上限に達していても新しい窓としてリセットし許可する", () => {
    const now = new Date("2026-09-29T00:20:00.000Z");
    const windowStartedAt = new Date("2026-09-29T00:00:00.000Z");
    const result = evaluateDiagnosisRateLimitScope(
      { windowStartedAt, countInWindow: 3, inFlightSince: null },
      CONFIG,
      TTL,
      now
    );
    expect(result).toEqual({
      allowed: true,
      nextState: { windowStartedAt: now, countInWindow: 1 },
    });
  });

  it("inFlightSinceがTTL内ならin_flightで拒否する(同時実行防止)", () => {
    const now = new Date("2026-09-29T00:01:00.000Z");
    const inFlightSince = new Date("2026-09-29T00:00:00.000Z");
    const result = evaluateDiagnosisRateLimitScope(
      { windowStartedAt: now, countInWindow: 0, inFlightSince },
      CONFIG,
      TTL,
      now
    );
    expect(result).toEqual({
      allowed: false,
      reason: "in_flight",
      retryAt: new Date(inFlightSince.getTime() + TTL),
    });
  });

  it("enforceInFlightLock=falseのスコープ(IP等)は、inFlightSinceが有効でも同時実行ロックを適用しない(回数制限のみで判定)", () => {
    const now = new Date("2026-09-29T00:01:00.000Z");
    const inFlightSince = new Date("2026-09-29T00:00:00.000Z");
    const result = evaluateDiagnosisRateLimitScope(
      { windowStartedAt: now, countInWindow: 0, inFlightSince },
      { ...CONFIG, enforceInFlightLock: false },
      TTL,
      now
    );
    expect(result.allowed).toBe(true);
  });

  it("inFlightSinceがTTLを超えている場合(古い処理によるロック誤解除対策)は新規実行として許可する", () => {
    const inFlightSince = new Date("2026-09-29T00:00:00.000Z");
    const now = new Date(inFlightSince.getTime() + TTL + 1000); // TTLを1秒超過
    const result = evaluateDiagnosisRateLimitScope(
      { windowStartedAt: inFlightSince, countInWindow: 1, inFlightSince },
      CONFIG,
      TTL,
      now
    );
    expect(result.allowed).toBe(true);
  });
});

describe("combineDiagnosisRateLimitDecisions", () => {
  it("すべて許可なら全体を許可する", () => {
    const allowed = { allowed: true as const, nextState: { windowStartedAt: new Date(), countInWindow: 1 } };
    expect(combineDiagnosisRateLimitDecisions([allowed, allowed])).toEqual({ allowed: true });
  });

  it("1つでも拒否があれば全体を拒否する(全条件を満たした場合だけ実行を許可する)", () => {
    const allowed = { allowed: true as const, nextState: { windowStartedAt: new Date(), countInWindow: 1 } };
    const rateLimited = {
      allowed: false as const,
      reason: "rate_limited" as const,
      retryAt: new Date("2026-09-29T01:00:00.000Z"),
    };
    const result = combineDiagnosisRateLimitDecisions([allowed, rateLimited]);
    expect(result).toEqual({ allowed: false, reason: "rate_limited", retryAt: rateLimited.retryAt });
  });

  it("in_flightとrate_limitedが両方ある場合、in_flightを理由として優先する", () => {
    const inFlight = {
      allowed: false as const,
      reason: "in_flight" as const,
      retryAt: new Date("2026-09-29T00:05:00.000Z"),
    };
    const rateLimited = {
      allowed: false as const,
      reason: "rate_limited" as const,
      retryAt: new Date("2026-09-29T01:00:00.000Z"),
    };
    const result = combineDiagnosisRateLimitDecisions([inFlight, rateLimited]);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe("in_flight");
      // 最も遅いretryAtを採用する
      expect(result.retryAt).toEqual(rateLimited.retryAt);
    }
  });
});
