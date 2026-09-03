import { describe, expect, it } from "vitest";
import {
  calculateScoreBreakdown,
  domainAchievementRate,
  InvalidDomainScoreError,
} from "@/domain/diagnosis/scoring";
import type { DomainScoreInput } from "@/domain/diagnosis/scoring";

const fullMeasuredInput: DomainScoreInput[] = [
  { domain: "AIO", status: "measured", points: 20, evidence: [] },
  { domain: "MEO", status: "measured", points: 15, evidence: [] },
  { domain: "SEO", status: "measured", points: 10, evidence: [] },
  { domain: "LLMO", status: "measured", points: 10, evidence: [] },
  { domain: "WEB_BOOKING", status: "measured", points: 8, evidence: [] },
  { domain: "REVIEWS", status: "measured", points: 7, evidence: [] },
];

describe("calculateScoreBreakdown", () => {
  it("全domain測定済みならtotalStatusはmeasured", () => {
    const result = calculateScoreBreakdown(fullMeasuredInput);
    expect(result.totalPoints).toBe(70);
    expect(result.totalStatus).toBe("measured");
    expect(result.measuredDomainCount).toBe(6);
  });

  it("unavailableなdomainを0点扱いせずtotalStatusをpartialにする", () => {
    const input = fullMeasuredInput.map((d) =>
      d.domain === "MEO"
        ? { domain: "MEO" as const, status: "unavailable" as const, evidence: ["未登録"] }
        : d
    );
    const result = calculateScoreBreakdown(input);
    const meo = result.domains.find((d) => d.domain === "MEO");
    expect(meo?.points).toBeNull();
    expect(meo?.status).toBe("unavailable");
    expect(result.totalStatus).toBe("partial");
    // MEO(15点)を除いた残り5領域の合計のみ
    expect(result.totalPoints).toBe(70 - 15);
  });

  it("estimatedを含む場合はtotalStatusがestimated(unavailableがない場合)", () => {
    const input = fullMeasuredInput.map((d) =>
      d.domain === "SEO" ? { ...d, status: "estimated" as const } : d
    );
    const result = calculateScoreBreakdown(input);
    expect(result.totalStatus).toBe("estimated");
  });

  it("配点上限を超えるとエラーになる", () => {
    const input = fullMeasuredInput.map((d) =>
      d.domain === "AIO" ? { ...d, points: 999 } : d
    );
    expect(() => calculateScoreBreakdown(input)).toThrow(InvalidDomainScoreError);
  });

  it("6領域が揃っていないとエラーになる", () => {
    expect(() => calculateScoreBreakdown(fullMeasuredInput.slice(0, 5))).toThrow(
      InvalidDomainScoreError
    );
  });
});

describe("domainAchievementRate", () => {
  it("unavailableはnullを返す(0扱いしない)", () => {
    const rate = domainAchievementRate({
      domain: "MEO",
      maxPoints: 20,
      points: null,
      status: "unavailable",
      evidence: [],
    });
    expect(rate).toBeNull();
  });

  it("measuredはpoints/maxPointsを返す", () => {
    const rate = domainAchievementRate({
      domain: "MEO",
      maxPoints: 20,
      points: 10,
      status: "measured",
      evidence: [],
    });
    expect(rate).toBe(0.5);
  });
});
