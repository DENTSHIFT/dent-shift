import { describe, expect, it } from "vitest";
import {
  calculateDomainScore,
  calculateScoreBreakdown,
  domainAchievementRate,
  InvalidDomainScoreError,
} from "@/domain/diagnosis/scoring";
import { DOMAIN_CRITERIA, DOMAIN_ORDER, getDomainMaxPoints, getTotalMaxPoints } from "@/domain/diagnosis/scoreCriteria";
import type { CriterionScore, DomainKey, DomainScore, UnavailableReason } from "@/domain/diagnosis/types";

const FIXED_MEASURED_AT = "2026-01-01T00:00:00.000Z";

/** 正本の配点(maxScore)を満点で満たした、指定domain分のcriteria一式を作る */
function buildFullCriteria(domain: DomainKey): CriterionScore[] {
  return DOMAIN_CRITERIA[domain].map((def) => ({
    key: def.key,
    label: def.label,
    maxScore: def.maxScore,
    score: def.maxScore,
    status: "estimated",
    evidence: [{ summary: `test: ${def.label}満点`, ruleKey: def.ruleKey }],
    measuredAt: FIXED_MEASURED_AT,
    dataSource: "mock",
    unavailableReason: null,
  }));
}

/** 指定domainの全criterionをunavailable(取得不能)にする(既定理由は"not_connected") */
function buildUnavailableCriteria(
  domain: DomainKey,
  unavailableReason: UnavailableReason = "not_connected"
): CriterionScore[] {
  return DOMAIN_CRITERIA[domain].map((def) => ({
    key: def.key,
    label: def.label,
    maxScore: def.maxScore,
    score: null,
    status: "unavailable",
    evidence: [{ summary: "test: 未接続のため測定不能" }],
    measuredAt: null,
    dataSource: "mock",
    unavailableReason,
  }));
}

function buildFullBreakdownDomainScores(): DomainScore[] {
  return DOMAIN_ORDER.map((domain) => calculateDomainScore(domain, buildFullCriteria(domain)));
}

describe("正本の配点(scoreCriteria)", () => {
  it("6領域の配点合計は100点である", () => {
    expect(getTotalMaxPoints()).toBe(100);
  });

  it("各領域のmaxPointsはサブ項目maxScoreの合計と一致する", () => {
    for (const domain of DOMAIN_ORDER) {
      const expected = DOMAIN_CRITERIA[domain].reduce((sum, c) => sum + c.maxScore, 0);
      expect(getDomainMaxPoints(domain)).toBe(expected);
    }
  });
});

describe("calculateDomainScore", () => {
  it("全criterionが満点ならpoints=maxPoints、assessedMaxPoints=maxPoints、coverage=1", () => {
    const result = calculateDomainScore("MEO", buildFullCriteria("MEO"));
    expect(result.maxPoints).toBe(getDomainMaxPoints("MEO"));
    expect(result.points).toBe(result.maxPoints);
    expect(result.assessedMaxPoints).toBe(result.maxPoints);
    expect(result.coverage).toBe(1);
    // 実測(measured)は1件もないため、全体はestimated
    expect(result.status).toBe("estimated");
  });

  it("一部criterionがunavailableでも0点として合算せず、assessedMaxPointsから除外する(単純100点換算しない)", () => {
    const criteria = buildFullCriteria("MEO");
    const unavailableIdx = 0;
    const target = criteria[unavailableIdx];
    if (!target) throw new Error("test fixture broken: criteria is empty");
    const removedMaxScore = target.maxScore;
    criteria[unavailableIdx] = {
      ...target,
      score: null,
      status: "unavailable",
      measuredAt: null,
      evidence: [{ summary: "test: 未接続" }],
      unavailableReason: "not_connected",
    };

    const result = calculateDomainScore("MEO", criteria);
    const domainMax = getDomainMaxPoints("MEO");

    expect(result.maxPoints).toBe(domainMax); // 満点は正本のまま固定
    expect(result.assessedMaxPoints).toBe(domainMax - removedMaxScore); // 測定できた分だけ
    // 残りcriterionは全て満点のまま(unavailableにした分を除いた満点)
    expect(result.points).toBe(domainMax - removedMaxScore);
    expect(result.coverage).toBeLessThan(1);
    expect(result.status).toBe("partial");
  });

  it("全criterionがunavailableならdomain status も unavailable、points=0", () => {
    const result = calculateDomainScore("WEB_BOOKING", buildUnavailableCriteria("WEB_BOOKING"));
    expect(result.assessedMaxPoints).toBe(0);
    expect(result.points).toBe(0);
    expect(result.coverage).toBe(0);
    expect(result.status).toBe("unavailable");
  });

  it("criterionの件数が正本の定義数と異なるとエラーになる", () => {
    const criteria = buildFullCriteria("SEO").slice(0, 3);
    expect(() => calculateDomainScore("SEO", criteria)).toThrow(InvalidDomainScoreError);
  });

  it("正本に存在しないkeyや不足しているkeyがあるとエラーになる", () => {
    const criteria = buildFullCriteria("SEO");
    const first = criteria[0];
    if (!first) throw new Error("test fixture broken: criteria is empty");
    criteria[0] = { ...first, key: "not_in_catalog" };
    expect(() => calculateDomainScore("SEO", criteria)).toThrow(InvalidDomainScoreError);
  });

  it("maxScoreが正本の配点と一致しないとエラーになる", () => {
    const criteria = buildFullCriteria("SEO");
    const first = criteria[0];
    if (!first) throw new Error("test fixture broken: criteria is empty");
    criteria[0] = { ...first, maxScore: first.maxScore + 1 };
    expect(() => calculateDomainScore("SEO", criteria)).toThrow(InvalidDomainScoreError);
  });

  it("unavailableなのにscoreやmeasuredAtがnullでないとエラーになる", () => {
    const criteria = buildUnavailableCriteria("REVIEWS");
    const first = criteria[0];
    if (!first) throw new Error("test fixture broken: criteria is empty");
    criteria[0] = { ...first, score: 1 };
    expect(() => calculateDomainScore("REVIEWS", criteria)).toThrow(InvalidDomainScoreError);
  });

  it("scoreが配点範囲(0〜maxScore)を超えるとエラーになる", () => {
    const criteria = buildFullCriteria("REVIEWS");
    const first = criteria[0];
    if (!first) throw new Error("test fixture broken: criteria is empty");
    criteria[0] = { ...first, score: first.maxScore + 1 };
    expect(() => calculateDomainScore("REVIEWS", criteria)).toThrow(InvalidDomainScoreError);
  });
});

describe("calculateScoreBreakdown", () => {
  it("6領域すべて測定済みならmaxPoints=100、totalPoints=100点満点合計と一致する", () => {
    const result = calculateScoreBreakdown(buildFullBreakdownDomainScores());
    expect(result.maxPoints).toBe(100);
    expect(result.totalPoints).toBe(100);
    expect(result.assessedMaxPoints).toBe(100);
    expect(result.coverage).toBe(1);
    expect(result.totalStatus).toBe("estimated");
  });

  it("表示順はDOMAIN_ORDER(AIO→LLMO→MEO→SEO→WEB_BOOKING→REVIEWS)に揃う", () => {
    const shuffled = [...buildFullBreakdownDomainScores()].reverse();
    const result = calculateScoreBreakdown(shuffled);
    expect(result.domains.map((d) => d.domain)).toEqual(DOMAIN_ORDER);
  });

  it("1領域がunavailableでも、その領域のmaxPointsを0点として合算しない(totalPointsから除外するだけ)", () => {
    const domainScores = buildFullBreakdownDomainScores().map((d) =>
      d.domain === "MEO" ? calculateDomainScore("MEO", buildUnavailableCriteria("MEO")) : d
    );
    const result = calculateScoreBreakdown(domainScores);
    const meoMax = getDomainMaxPoints("MEO");

    expect(result.maxPoints).toBe(100); // 満点は常に100のまま
    expect(result.assessedMaxPoints).toBe(100 - meoMax); // 測定できた分だけ
    expect(result.totalPoints).toBe(100 - meoMax);
    expect(result.coverage).toBeLessThan(1);
    expect(result.totalStatus).toBe("partial");
  });

  it("6領域揃っていないとエラーになる", () => {
    expect(() => calculateScoreBreakdown(buildFullBreakdownDomainScores().slice(0, 5))).toThrow(
      InvalidDomainScoreError
    );
  });

  it("1領域が一部criterionのみunavailable(domain status=partial)でも、totalStatusにpartialが正しく伝播する", () => {
    // MEOの1criterionだけをunavailableにする(domain status は "unavailable" ではなく "partial" になる)
    const meoCriteria = buildFullCriteria("MEO");
    const first = meoCriteria[0];
    if (!first) throw new Error("test fixture broken: criteria is empty");
    meoCriteria[0] = { ...first, score: null, status: "unavailable", measuredAt: null, unavailableReason: "not_connected" };
    const meoPartial = calculateDomainScore("MEO", meoCriteria);
    expect(meoPartial.status).toBe("partial");

    const domainScores = buildFullBreakdownDomainScores().map((d) =>
      d.domain === "MEO" ? meoPartial : d
    );
    const result = calculateScoreBreakdown(domainScores);
    // 他5領域は"measured"級のestimatedのみで"unavailable"なdomainは無いが、
    // MEOのpartialを見逃さずtotalStatusをpartialにしなければならない
    expect(result.totalStatus).toBe("partial");
  });
});

describe("domainAchievementRate", () => {
  it("unavailableはnullを返す(0扱いしない)", () => {
    const domainScore = calculateDomainScore("MEO", buildUnavailableCriteria("MEO"));
    expect(domainAchievementRate(domainScore)).toBeNull();
  });

  it("assessed分のpoints/maxPointsを返す", () => {
    const domainScore = calculateDomainScore("MEO", buildFullCriteria("MEO"));
    expect(domainAchievementRate(domainScore)).toBe(1);
  });
});

describe("unavailableReason(2026-09-06のユーザー指示④: 診断データの意味を失わず保持するdomain仕様)", () => {
  const ALL_REASONS: UnavailableReason[] = [
    "not_provided",
    "not_connected",
    "permission_required",
    "insufficient_data",
    "temporarily_unavailable",
    "fetch_failed",
    "not_applicable",
  ];

  it.each(ALL_REASONS)(
    "unavailable + %s: calculateDomainScoreがエラーにならず、score/assessedMaxPointsへ0点として加算されない",
    (reason) => {
      const criteria = buildUnavailableCriteria("REVIEWS", reason);
      const result = calculateDomainScore("REVIEWS", criteria);
      expect(result.status).toBe("unavailable");
      expect(result.points).toBe(0);
      expect(result.assessedMaxPoints).toBe(0);
      // reasonの値に関わらず、unavailableは常にscore=nullのまま(0点扱いに変換しない)
      for (const c of result.criteria) {
        expect(c.score).toBeNull();
        expect(c.unavailableReason).toBe(reason);
      }
    }
  );

  it("unavailableなのにunavailableReasonがnullだとエラーになる(基本ルール1)", () => {
    const criteria = buildUnavailableCriteria("REVIEWS");
    const first = criteria[0];
    if (!first) throw new Error("test fixture broken: criteria is empty");
    // 型システムを迂回して意図的に不正な状態を作る(実行時バリデーションの検証)
    criteria[0] = { ...first, unavailableReason: null as unknown as UnavailableReason };
    expect(() => calculateDomainScore("REVIEWS", criteria)).toThrow(InvalidDomainScoreError);
  });

  it("measured/estimatedなのにunavailableReasonが設定されているとエラーになる(基本ルール4: 正常な結果へ理由を付けない)", () => {
    const criteria = buildFullCriteria("REVIEWS");
    const first = criteria[0];
    if (!first) throw new Error("test fixture broken: criteria is empty");
    criteria[0] = { ...first, unavailableReason: "fetch_failed" };
    expect(() => calculateDomainScore("REVIEWS", criteria)).toThrow(InvalidDomainScoreError);
  });

  it("measured/estimatedな結果にはunavailableReasonが付かない(基本ルール4)", () => {
    const result = calculateDomainScore("REVIEWS", buildFullCriteria("REVIEWS"));
    for (const c of result.criteria) {
      expect(c.unavailableReason).toBeNull();
    }
  });

  it("JSON serialize/deserializeでunavailableReasonが保持される(永続化はJSON.stringifyでそのまま行うため)", () => {
    const result = calculateDomainScore("MEO", buildUnavailableCriteria("MEO", "permission_required"));
    const restored = JSON.parse(JSON.stringify(result)) as typeof result;
    expect(restored.criteria[0]!.unavailableReason).toBe("permission_required");
  });
});
