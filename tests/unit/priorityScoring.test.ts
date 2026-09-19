import { describe, expect, it } from "vitest";
import {
  computeAxisScores,
  deduplicateByRootCause,
  generateImprovementCandidates,
  rankImprovementCandidates,
  scoreImprovementCandidates,
  selectTopImprovements,
  tierFromTotal,
} from "@/domain/improvement-task/priorityScoring";
import { ESCALATION_CATEGORY_ORDER } from "@/domain/improvement-task/types";
import { IMPROVEMENT_RULE_CATALOG } from "@/domain/improvement-task/candidateCatalog";
import { calculateDomainScore, calculateScoreBreakdown } from "@/domain/diagnosis/scoring";
import { DOMAIN_CRITERIA, DOMAIN_ORDER } from "@/domain/diagnosis/scoreCriteria";
import type { CriterionScore, DomainKey, DomainScore, UnavailableReason } from "@/domain/diagnosis/types";
import type { PatientQuestionResult } from "@/domain/competitor/types";
import { NOT_APPLICABLE_LOSS_ATTRIBUTION } from "@/domain/competitor/aioLossAttribution";
import { isEscalationEligible } from "@/domain/ad-compliance/escalationEligibility";
import { describeAdRiskMessage, describeSourceLabel, isProvisionalSourceType } from "@/domain/ad-compliance/riskCatalog";
import type {
  AdRiskConfidence,
  AdRiskFinding,
  AdRiskFindingSourceType,
  AdRiskSeverity,
} from "@/domain/ad-compliance/types";

const FIXED_MEASURED_AT = "2026-01-01T00:00:00.000Z";

/**
 * 医療広告AIチェックのAdRiskFindingを組み立てるテスト用ヘルパー(2026-09-05の連携テスト用)。
 * sourceTypeは既定で"rule_based"(=mockではない実際の検出扱い)とし、mock由来の除外を
 * 検証するテストでは明示的にsourceType: "mock"を渡す。
 */
function buildAdRiskFinding(overrides: {
  id: string;
  severity: AdRiskSeverity;
  confidence: AdRiskConfidence;
  sourceType?: AdRiskFindingSourceType;
}): AdRiskFinding {
  const sourceType = overrides.sourceType ?? "rule_based";
  const escalationEligible = isEscalationEligible({ ...overrides, sourceType });
  return {
    id: overrides.id,
    category: "superlative_exaggeration",
    severity: overrides.severity,
    confidence: overrides.confidence,
    matchStrength: overrides.confidence === "high" ? "direct" : overrides.confidence === "medium" ? "partial" : "inferred",
    confidenceBasis: "test: confidenceBasis",
    evidence: [
      {
        category: "superlative_exaggeration",
        quotedText: "test evidence",
        sourceLocation: "test",
        detectionReason: "test",
        sourceType,
      },
    ],
    mergedOccurrenceCount: 1,
    displayMessage: describeAdRiskMessage(overrides.severity, escalationEligible),
    requiresReviewBy: "院長",
    escalationEligible,
    sourceType,
    provisional: isProvisionalSourceType(sourceType),
    sourceLabel: describeSourceLabel(sourceType),
  };
}

/** 指定domainの全criterionを、達成率(ratio)に応じたscoreで生成する(status: estimated) */
function buildCriteriaAtRatio(domain: DomainKey, ratio: number): CriterionScore[] {
  return DOMAIN_CRITERIA[domain].map((def) => {
    const score = Math.round(def.maxScore * ratio);
    return {
      key: def.key,
      label: def.label,
      maxScore: def.maxScore,
      score,
      status: "estimated",
      evidence: [{ summary: `test: ${def.label} ${score}/${def.maxScore}`, ruleKey: def.ruleKey }],
      measuredAt: FIXED_MEASURED_AT,
      dataSource: "mock",
      unavailableReason: null,
    };
  });
}

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

/** 指定domain内の1criterionのみunavailableにし、他は指定ratioで生成する(evidence不足ゲートの検証用) */
function buildCriteriaWithUnavailableKey(domain: DomainKey, otherRatio: number, unavailableKey: string): CriterionScore[] {
  return DOMAIN_CRITERIA[domain].map((def) => {
    if (def.key === unavailableKey) {
      return {
        key: def.key,
        label: def.label,
        maxScore: def.maxScore,
        score: null,
        status: "unavailable",
        evidence: [{ summary: "test: 当該項目のみ未接続のため測定不能" }],
        measuredAt: null,
        dataSource: "mock",
        unavailableReason: "not_connected",
      };
    }
    const score = Math.round(def.maxScore * otherRatio);
    return {
      key: def.key,
      label: def.label,
      maxScore: def.maxScore,
      score,
      status: "estimated",
      evidence: [{ summary: `test: ${def.label} ${score}/${def.maxScore}` }],
      measuredAt: FIXED_MEASURED_AT,
      dataSource: "mock",
      unavailableReason: null,
    };
  });
}

/** 領域ごとにratioを指定してDiagnosisScoreBreakdownを組み立てるテスト用ヘルパー */
function buildBreakdown(ratioByDomain: Partial<Record<DomainKey, number>>, unavailableDomains: DomainKey[] = []) {
  const domainScores: DomainScore[] = DOMAIN_ORDER.map((domain) => {
    if (unavailableDomains.includes(domain)) {
      return calculateDomainScore(domain, buildUnavailableCriteria(domain));
    }
    const ratio = ratioByDomain[domain] ?? 1.0;
    return calculateDomainScore(domain, buildCriteriaAtRatio(domain, ratio));
  });
  return calculateScoreBreakdown(domainScores);
}

describe("computeAxisScores(4軸の境界値)", () => {
  it("catalogPriority=urgent, 高配点domain, 単独担当, ripple=wide で各軸が満点(5)になる", () => {
    const axes = computeAxisScores("urgent", "AIO", "医院", "wide");
    expect(axes).toEqual({ catchmentImpact: 5, urgency: 5, easeOfExecution: 5, rippleEffect: 5 });
  });

  it("配点が10点の領域(Web予約導線/口コミ)は集患インパクトが1点下がる", () => {
    const axesHighWeight = computeAxisScores("top", "AIO", "医院", "narrow");
    const axesLowWeight = computeAxisScores("top", "WEB_BOOKING", "医院", "narrow");
    expect(axesHighWeight.catchmentImpact).toBe(5);
    expect(axesLowWeight.catchmentImpact).toBe(4);
  });

  it("catalogPriority=normalかつ担当が複数関係者・narrowの場合、各軸が低めになる", () => {
    const axes = computeAxisScores("normal", "WEB_BOOKING", "院長／制作会社", "narrow");
    expect(axes).toEqual({ catchmentImpact: 2, urgency: 2, easeOfExecution: 3, rippleEffect: 1 });
  });

  it("すべての軸は0〜5の範囲に収まる", () => {
    const priorities: Array<"urgent" | "top" | "high" | "normal"> = ["urgent", "top", "high", "normal"];
    const ripples: Array<"narrow" | "moderate" | "wide"> = ["narrow", "moderate", "wide"];
    for (const p of priorities) {
      for (const domain of DOMAIN_ORDER) {
        for (const ripple of ripples) {
          const axes = computeAxisScores(p, domain, "制作会社", ripple);
          for (const v of Object.values(axes)) {
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(5);
          }
        }
      }
    }
  });
});

describe("tierFromTotal(表示区分の閾値)", () => {
  it.each([
    [20, "top"],
    [16, "top"],
    [15, "priority"],
    [11, "priority"],
    [10, "normal"],
    [6, "normal"],
    [5, "monitor"],
    [0, "monitor"],
  ] as const)("合計%i点は%s区分になる", (total, expected) => {
    expect(tierFromTotal(total)).toBe(expected);
  });
});

describe("generateImprovementCandidates / scoreImprovementCandidates(候補生成と採点)", () => {
  it("全領域が健全(達成率100%)なら候補は1件も生成されない", () => {
    const breakdown = buildBreakdown({});
    const drafts = generateImprovementCandidates({ breakdown, questionResults: [] });
    expect(drafts).toEqual([]);
  });

  it("全領域が0点なら正本45項目すべてが発火し、data_gapは生成されない", () => {
    const ratioByDomain = Object.fromEntries(DOMAIN_ORDER.map((d) => [d, 0])) as Record<DomainKey, number>;
    const breakdown = buildBreakdown(ratioByDomain);
    const drafts = generateImprovementCandidates({ breakdown, questionResults: [] });
    expect(drafts.length).toBe(45);
    expect(drafts.some((d) => d.kind === "data_gap")).toBe(false);

    const scored = scoreImprovementCandidates(drafts);
    const escalationCount = scored.filter((c) => c.kind === "risk_escalation").length;
    const standardCount = scored.filter((c) => c.kind === "standard").length;
    expect(escalationCount).toBe(14);
    expect(standardCount).toBe(31);
    // 20点満点への無理な変換はしない(escalationも通常のpriorityスコアを別途保持する)
    for (const c of scored) {
      expect(c.priority).toBeDefined();
      expect(c.priority!.total).toBeGreaterThanOrEqual(0);
      expect(c.priority!.total).toBeLessThanOrEqual(20);
    }
  });

  it("domain全体がunavailableな場合、個別criterionのルールは発火せずdata_gap候補が1件だけ生成される", () => {
    const breakdown = buildBreakdown({}, ["MEO", "WEB_BOOKING"]);
    const drafts = generateImprovementCandidates({ breakdown, questionResults: [] });
    const dataGaps = drafts.filter((d) => d.kind === "data_gap");
    expect(dataGaps.map((d) => d.domain).sort()).toEqual(["MEO", "WEB_BOOKING"]);
    // MEO/WEB_BOOKING由来のcatalogルールは発火しない(重複・矛盾候補を作らない)
    const meoOrBookingRuleKeys = new Set(
      IMPROVEMENT_RULE_CATALOG.filter((r) => r.evidenceDomain === "MEO" || r.evidenceDomain === "WEB_BOOKING").map(
        (r) => r.key
      )
    );
    expect(drafts.some((d) => meoOrBookingRuleKeys.has(d.key))).toBe(false);
  });

  it("予約導線(WEB_BOOKING)のunavailableはblocking=true、GBP(MEO)のunavailableはblocking=false", () => {
    const breakdown = buildBreakdown({}, ["MEO", "WEB_BOOKING"]);
    const scored = scoreImprovementCandidates(generateImprovementCandidates({ breakdown, questionResults: [] }));
    const meoGap = scored.find((c) => c.key === "data-gap-MEO");
    const bookingGap = scored.find((c) => c.key === "data-gap-WEB_BOOKING");
    expect(meoGap?.dataGap?.blocking).toBe(false);
    expect(bookingGap?.dataGap?.blocking).toBe(true);
    // データ不足は推測採点しない(priorityを持たない)
    expect(meoGap?.priority).toBeUndefined();
    expect(bookingGap?.priority).toBeUndefined();
    // 「医院の弱点」と断定しない表現になっている
    expect(meoGap?.patientImpact).toContain("断定はできません");
    // dataGap.unavailableReasonは、根拠となったcriterionのunavailableReason(既定"not_connected")を
    // そのまま機械的に引き継ぐ(2026-09-06のユーザー指示④)
    expect(meoGap?.dataGap?.unavailableReason).toBe("not_connected");
    expect(bookingGap?.dataGap?.unavailableReason).toBe("not_connected");
  });

  it("dataGap.unavailableReasonは根拠criterionの理由(not_connected以外)もそのまま機械的に引き継ぐ", () => {
    const domainScores = DOMAIN_ORDER.map((domain) =>
      domain === "MEO"
        ? calculateDomainScore("MEO", buildUnavailableCriteria("MEO", "permission_required"))
        : calculateDomainScore(domain, buildCriteriaAtRatio(domain, 1.0))
    );
    const breakdown = calculateScoreBreakdown(domainScores);
    const scored = scoreImprovementCandidates(generateImprovementCandidates({ breakdown, questionResults: [] }));
    const meoGap = scored.find((c) => c.key === "data-gap-MEO");
    expect(meoGap?.dataGap?.unavailableReason).toBe("permission_required");
  });

  it("insufficient_dataの質問は「AIに選ばれていない質問」候補の母集団から除外される", () => {
    const breakdown = buildBreakdown({});
    const questionResults: PatientQuestionResult[] = [
      { question: "q1(データ不足)", status: "insufficient_data", unavailableReason: "insufficient_data", evidence: [], ...NOT_APPLICABLE_LOSS_ATTRIBUTION },
      { question: "q2(負け)", status: "lose", unavailableReason: null, evidence: ["ev"], ...NOT_APPLICABLE_LOSS_ATTRIBUTION },
      { question: "q3(勝ち)", status: "win", unavailableReason: null, evidence: [], ...NOT_APPLICABLE_LOSS_ATTRIBUTION },
    ];
    const drafts = generateImprovementCandidates({ breakdown, questionResults });
    const losing = drafts.find((d) => d.key === "aio-losing-patient-questions");
    expect(losing).toBeDefined();
    expect(losing!.detectedFact).toContain("1件");
    expect(losing!.detectedFact).not.toContain("q1(データ不足)");
  });

  it("全質問がinsufficient_dataの場合、AIOのdata_gap(blocking)候補を生成し、負け候補は生成しない", () => {
    const breakdown = buildBreakdown({});
    const questionResults: PatientQuestionResult[] = [
      { question: "q1", status: "insufficient_data", unavailableReason: "insufficient_data", evidence: [], ...NOT_APPLICABLE_LOSS_ATTRIBUTION },
      { question: "q2", status: "insufficient_data", unavailableReason: "insufficient_data", evidence: [], ...NOT_APPLICABLE_LOSS_ATTRIBUTION },
    ];
    const drafts = generateImprovementCandidates({ breakdown, questionResults });
    expect(drafts.some((d) => d.key === "data-gap-ai-observation")).toBe(true);
    expect(drafts.some((d) => d.key === "aio-losing-patient-questions")).toBe(false);
    const scored = scoreImprovementCandidates(drafts);
    const aiGap = scored.find((c) => c.key === "data-gap-ai-observation");
    expect(aiGap?.dataGap?.blocking).toBe(true);
    // insufficient_data状態は常にunavailableReason="insufficient_data"を保持する(基本ルール2)
    expect(aiGap?.dataGap?.unavailableReason).toBe("insufficient_data");
  });
});

describe("rankImprovementCandidates / selectTopImprovements(順位付けとTOP3選定)", () => {
  it("重大リスクエスカレーションは常に通常の20点ランキングより上位に来る", () => {
    const ratioByDomain = Object.fromEntries(DOMAIN_ORDER.map((d) => [d, 0])) as Record<DomainKey, number>;
    const breakdown = buildBreakdown(ratioByDomain);
    const scored = scoreImprovementCandidates(generateImprovementCandidates({ breakdown, questionResults: [] }));
    const ranked = rankImprovementCandidates(scored);

    const firstStandardIndex = ranked.findIndex((c) => c.kind === "standard");
    const lastEscalationIndex = ranked.map((c) => c.kind).lastIndexOf("risk_escalation");
    expect(lastEscalationIndex).toBeLessThan(firstStandardIndex);

    // エスカレーション内は正本§8由来4分類の優先順位(法令→予約→情報不一致→クロール)で並ぶ
    const escalationCategories = ranked.filter((c) => c.kind === "risk_escalation").map((c) => c.escalation!.category);
    const categoryIndices = escalationCategories.map((cat) => ESCALATION_CATEGORY_ORDER.indexOf(cat));
    for (let i = 1; i < categoryIndices.length; i++) {
      expect(categoryIndices[i]!).toBeGreaterThanOrEqual(categoryIndices[i - 1]!);
    }
  });

  it("診断・予約計測を阻害するdata_gapはTOP3に入り得るが、阻害しないdata_gapは末尾に置かれる", () => {
    // エスカレーションは発火させず(ratio=0.5, escalationしきい値0.34以上)、
    // 通常の標準候補を複数発生させたうえでdata_gapの扱いだけを検証する
    const breakdown = buildBreakdown({ AIO: 0.5, LLMO: 0.5, SEO: 0.5, REVIEWS: 0.5 }, ["MEO", "WEB_BOOKING"]);
    const scored = scoreImprovementCandidates(generateImprovementCandidates({ breakdown, questionResults: [] }));
    const ranked = rankImprovementCandidates(scored);

    expect(scored.some((c) => c.kind === "risk_escalation")).toBe(false);
    expect(ranked.length).toBeGreaterThan(3); // TOP3に入りきらない候補が存在する前提のテスト

    const bookingGapIndex = ranked.findIndex((c) => c.key === "data-gap-WEB_BOOKING");
    const meoGapIndex = ranked.findIndex((c) => c.key === "data-gap-MEO");
    expect(bookingGapIndex).toBe(0); // 阻害するdata_gapは標準候補より先頭
    expect(meoGapIndex).toBe(ranked.length - 1); // 阻害しないdata_gapは最後に1件だけ

    const top3 = selectTopImprovements(ranked);
    expect(top3.some((c) => c.key === "data-gap-WEB_BOOKING")).toBe(true);
    expect(top3.some((c) => c.key === "data-gap-MEO")).toBe(false);
  });

  it("TOP3は常に3件以下であり、候補が3件未満ならその件数を返す", () => {
    const breakdown = buildBreakdown({ AIO: 0 });
    const scored = scoreImprovementCandidates(generateImprovementCandidates({ breakdown, questionResults: [] }));
    const ranked = rankImprovementCandidates(scored);
    const top3 = selectTopImprovements(ranked);
    expect(top3.length).toBeLessThanOrEqual(3);
    expect(top3.length).toBe(Math.min(3, ranked.length));
  });

  it("ランキングは決定的である(同一入力を2回評価しても順序が完全に一致する)", () => {
    const ratioByDomain = Object.fromEntries(DOMAIN_ORDER.map((d) => [d, 0])) as Record<DomainKey, number>;
    const breakdown = buildBreakdown(ratioByDomain);
    const drafts1 = generateImprovementCandidates({ breakdown, questionResults: [] });
    const drafts2 = generateImprovementCandidates({ breakdown, questionResults: [] });
    const ranked1 = rankImprovementCandidates(scoreImprovementCandidates(drafts1)).map((c) => c.key);
    const ranked2 = rankImprovementCandidates(scoreImprovementCandidates(drafts2)).map((c) => c.key);
    expect(ranked1).toEqual(ranked2);
  });
});

describe("deduplicateByRootCause(rootCauseKeyによる重複整理、2026-09-05の構造再整理)", () => {
  it("同一rootCauseKeyを共有するstandard候補は、優先度が最も高い1件に集約される", () => {
    const ratioByDomain = Object.fromEntries(DOMAIN_ORDER.map((d) => [d, 0])) as Record<DomainKey, number>;
    const breakdown = buildBreakdown(ratioByDomain);
    const scored = scoreImprovementCandidates(generateImprovementCandidates({ breakdown, questionResults: [] }));
    const deduped = deduplicateByRootCause(scored);

    const standardDeduped = deduped.filter((c) => c.kind === "standard");
    const rootCauseKeys = standardDeduped.map((c) => c.rootCauseKey);
    // 重複整理後、standard候補内でrootCauseKeyが重複しない
    expect(new Set(rootCauseKeys).size).toBe(rootCauseKeys.length);

    // 45件中、standard31件のうち8グループ・9件がrootCauseKey重複により集約される
    expect(standardDeduped.length).toBe(22);
    expect(deduped.length).toBe(36);

    // TOP3選定後もrootCauseKeyは重複しない
    const ranked = rankImprovementCandidates(deduped);
    const top3 = selectTopImprovements(ranked);
    const top3StandardRootCauseKeys = top3.filter((c) => c.kind === "standard").map((c) => c.rootCauseKey);
    expect(new Set(top3StandardRootCauseKeys).size).toBe(top3StandardRootCauseKeys.length);
  });

  it("risk_escalationは重複整理の対象外であり、同じrootCauseKeyのstandard候補があっても常に残る(escalationが優先)", () => {
    const ratioByDomain = Object.fromEntries(DOMAIN_ORDER.map((d) => [d, 0])) as Record<DomainKey, number>;
    const breakdown = buildBreakdown(ratioByDomain);
    const scored = scoreImprovementCandidates(generateImprovementCandidates({ breakdown, questionResults: [] }));
    const deduped = deduplicateByRootCause(scored);

    // WEB_BOOKING:form_usability は escalation(booking-form-error)と
    // standard(booking-too-many-fields/booking-popup-interferes)がrootCauseKeyを共有するグループ
    const formUsabilityGroup = deduped.filter((c) => c.rootCauseKey === "WEB_BOOKING:form_usability");
    expect(formUsabilityGroup.some((c) => c.key === "booking-form-error" && c.kind === "risk_escalation")).toBe(true);
    // standard側は2件→1件に集約されるが、escalationは重複整理の対象外なので別途1件残る
    expect(formUsabilityGroup.filter((c) => c.kind === "standard").length).toBe(1);
    expect(formUsabilityGroup.length).toBe(2);

    // ランキングでも重大リスクエスカレーションが通常の重複整理・20点ランキングより優先される
    const ranked = rankImprovementCandidates(deduped);
    const escalationIndex = ranked.findIndex((c) => c.key === "booking-form-error");
    const standardIndex = ranked.findIndex((c) => c.rootCauseKey === "WEB_BOOKING:form_usability" && c.kind === "standard");
    expect(escalationIndex).toBeGreaterThanOrEqual(0);
    expect(standardIndex).toBeGreaterThanOrEqual(0);
    expect(escalationIndex).toBeLessThan(standardIndex);
  });
});

describe("displayDomain / evidenceDomain(cross-domain項目の保持、2026-09-05の構造再整理)", () => {
  it("cross-domain項目(表示領域と根拠領域が異なる4項目)が正しく保持される", () => {
    const crossDomainExpectations: Array<{ key: string; displayDomain: DomainKey; evidenceDomain: DomainKey }> = [
      { key: "aio-structured-data-missing", displayDomain: "AIO", evidenceDomain: "LLMO" },
      { key: "aio-update-date-unclear", displayDomain: "AIO", evidenceDomain: "LLMO" },
      { key: "aio-crawl-blocked", displayDomain: "AIO", evidenceDomain: "LLMO" },
      { key: "llmo-no-direct-answer", displayDomain: "LLMO", evidenceDomain: "AIO" },
    ];
    for (const expected of crossDomainExpectations) {
      const rule = IMPROVEMENT_RULE_CATALOG.find((r) => r.key === expected.key)!;
      expect(rule.displayDomain, `${expected.key}: displayDomain`).toBe(expected.displayDomain);
      expect(rule.evidenceDomain, `${expected.key}: evidenceDomain`).toBe(expected.evidenceDomain);
    }

    // 生成された候補側でも、domain(表示。UI互換フィールド)とevidenceDomain(根拠)が分離して保持される
    const ratioByDomain = Object.fromEntries(DOMAIN_ORDER.map((d) => [d, 0])) as Record<DomainKey, number>;
    const breakdown = buildBreakdown(ratioByDomain);
    const scored = scoreImprovementCandidates(generateImprovementCandidates({ breakdown, questionResults: [] }));
    const structuredData = scored.find((c) => c.key === "aio-structured-data-missing")!;
    expect(structuredData.domain).toBe("AIO");
    expect(structuredData.evidenceDomain).toBe("LLMO");
    const noDirectAnswer = scored.find((c) => c.key === "llmo-no-direct-answer")!;
    expect(noDirectAnswer.domain).toBe("LLMO");
    expect(noDirectAnswer.evidenceDomain).toBe("AIO");
  });
});

describe("evidenceRequirements(evidence不足時の推測発火防止、2026-09-05の構造再整理)", () => {
  it("domain全体はunavailableでなくても、特定criterionのみ未接続の場合、そのcriterionのみを根拠とする候補は生成されない", () => {
    const domainScores = DOMAIN_ORDER.map((domain) => {
      if (domain === "AIO") {
        return calculateDomainScore(domain, buildCriteriaWithUnavailableKey("AIO", 1.0, "information_accuracy"));
      }
      return calculateDomainScore(domain, buildCriteriaAtRatio(domain, 1.0));
    });
    const breakdown = calculateScoreBreakdown(domainScores);

    // domain全体はunavailableではない(他4criterionは測定できている)ことの前提確認
    const aioScore = breakdown.domains.find((d) => d.domain === "AIO")!;
    expect(aioScore.status).not.toBe("unavailable");

    const drafts = generateImprovementCandidates({ breakdown, questionResults: [] });

    // information_accuracyのみを根拠とする候補(aio-basic-info-mismatch/aio-doctor-info-missing)は
    // evidenceRequirementsを満たさないため生成されない。代わりに推測で別シグナルを捏造することもしない
    expect(drafts.some((d) => d.key === "aio-basic-info-mismatch")).toBe(false);
    expect(drafts.some((d) => d.key === "aio-doctor-info-missing")).toBe(false);
    // domain全体のdata_gapとしても扱われない(部分的なunavailableのため)
    expect(drafts.some((d) => d.kind === "data_gap" && d.domain === "AIO")).toBe(false);
    // AIOの他criterionは健全(ratio=1.0)なので、AIO/evidenceDomain=AIOの候補は1件も生成されない
    expect(drafts.some((d) => d.domain === "AIO" || d.evidenceDomain === "AIO")).toBe(false);
  });
});

describe("provisional(45項目カタログの暫定マッピング明示、2026-09-05の構造再整理)", () => {
  it("candidateCatalog由来の候補はprovisional:trueを維持し、data_gap・質問結果由来の候補はprovisional:falseになる", () => {
    const ratioByDomain = Object.fromEntries(DOMAIN_ORDER.map((d) => [d, 0])) as Record<DomainKey, number>;
    const breakdown = buildBreakdown(ratioByDomain);
    const questionResults: PatientQuestionResult[] = [
      { question: "q1", status: "lose", unavailableReason: null, evidence: ["ev"], ...NOT_APPLICABLE_LOSS_ATTRIBUTION },
    ];
    const scored = scoreImprovementCandidates(generateImprovementCandidates({ breakdown, questionResults }));

    const catalogKeys = new Set(IMPROVEMENT_RULE_CATALOG.map((r) => r.key));
    expect(scored.filter((c) => catalogKeys.has(c.key)).length).toBe(45);
    for (const c of scored) {
      if (catalogKeys.has(c.key)) {
        expect(c.provisional, `${c.key}: provisionalがtrueではない`).toBe(true);
      } else {
        expect(c.provisional, `${c.key}: provisionalがfalseではない`).toBe(false);
      }
    }
  });
});

describe("医療広告AIチェックとの連携(2026-09-05のユーザー指示: 追加条件6)", () => {
  it("escalationEligible=trueの所見はTOP3へrisk_escalation(legal_medical_ad_privacy)として合流する", () => {
    const breakdown = buildBreakdown({}); // 全領域健全 = 通常のcatalog由来候補は発火しない
    const finding = buildAdRiskFinding({ id: "superlative_exaggeration#1", severity: "high", confidence: "high" });
    const drafts = generateImprovementCandidates({ breakdown, questionResults: [], adComplianceFindings: [finding] });
    expect(drafts.length).toBe(1);
    const scored = scoreImprovementCandidates(drafts);
    const candidate = scored[0]!;
    expect(candidate.kind).toBe("risk_escalation");
    expect(candidate.escalation?.category).toBe("legal_medical_ad_privacy");
    expect(candidate.domain).toBe("REVIEWS");
    expect(candidate.provisional).toBe(false);

    const ranked = rankImprovementCandidates(scored);
    const top3 = selectTopImprovements(ranked);
    expect(top3[0]!.key).toBe(`ad-compliance-${finding.id}`);
  });

  it("sourceType=mockの所見はseverity=high・confidence=highでもTOP3候補を生成しない(2026-09-05のユーザー指示)", () => {
    const breakdown = buildBreakdown({});
    const finding = buildAdRiskFinding({
      id: "mock-1",
      severity: "high",
      confidence: "high",
      sourceType: "mock",
    });
    expect(finding.escalationEligible).toBe(false);
    expect(finding.provisional).toBe(true);
    const drafts = generateImprovementCandidates({ breakdown, questionResults: [], adComplianceFindings: [finding] });
    expect(drafts.length).toBe(0);
  });

  it("escalationEligible=falseの所見(severity=high+confidence=low)はTOP3候補を生成しない", () => {
    const breakdown = buildBreakdown({});
    const finding = buildAdRiskFinding({ id: "superlative_exaggeration#2", severity: "high", confidence: "low" });
    expect(finding.escalationEligible).toBe(false);
    const drafts = generateImprovementCandidates({ breakdown, questionResults: [], adComplianceFindings: [finding] });
    expect(drafts.length).toBe(0);
  });

  it("severity=medium/lowの所見はconfidenceに関わらずTOP3候補を生成しない", () => {
    const breakdown = buildBreakdown({});
    const findings = [
      buildAdRiskFinding({ id: "a", severity: "medium", confidence: "high" }),
      buildAdRiskFinding({ id: "b", severity: "low", confidence: "high" }),
    ];
    const drafts = generateImprovementCandidates({ breakdown, questionResults: [], adComplianceFindings: findings });
    expect(drafts.length).toBe(0);
  });

  it("confidence=highはescalation severity=critical、confidence=mediumはescalation severity=highにマッピングされる", () => {
    const breakdown = buildBreakdown({});
    const highConfidence = buildAdRiskFinding({ id: "c1", severity: "high", confidence: "high" });
    const mediumConfidence = buildAdRiskFinding({ id: "c2", severity: "high", confidence: "medium" });
    const scored = scoreImprovementCandidates(
      generateImprovementCandidates({ breakdown, questionResults: [], adComplianceFindings: [highConfidence, mediumConfidence] })
    );
    const c1 = scored.find((c) => c.key === "ad-compliance-c1")!;
    const c2 = scored.find((c) => c.key === "ad-compliance-c2")!;
    expect(c1.escalation?.severity).toBe("critical");
    expect(c2.escalation?.severity).toBe("high");
  });

  it("医療広告AIチェック由来のrootCauseKeyは45項目カタログの重複整理(deduplicateByRootCause)と衝突・巻き込まれない", () => {
    const ratioByDomain = Object.fromEntries(DOMAIN_ORDER.map((d) => [d, 0])) as Record<DomainKey, number>;
    const breakdown = buildBreakdown(ratioByDomain);
    const findings = [
      buildAdRiskFinding({ id: "x1", severity: "high", confidence: "high" }),
      buildAdRiskFinding({ id: "x2", severity: "high", confidence: "high" }),
    ];
    const scored = scoreImprovementCandidates(
      generateImprovementCandidates({ breakdown, questionResults: [], adComplianceFindings: findings })
    );
    const deduped = deduplicateByRootCause(scored);
    // ad-compliance由来の2件はkind=risk_escalationのためdeduplicateByRootCauseの対象外(常に両方残る)
    expect(deduped.filter((c) => c.key.startsWith("ad-compliance-")).length).toBe(2);
    // rootCauseKeyが45項目カタログ側(`${DomainKey}:${criterionKey}`形式)と衝突しない
    const adComplianceRootCauseKeys = scored.filter((c) => c.key.startsWith("ad-compliance-")).map((c) => c.rootCauseKey);
    expect(adComplianceRootCauseKeys).toEqual(["ad-compliance:superlative_exaggeration:x1", "ad-compliance:superlative_exaggeration:x2"]);
  });

  it("既存の重大リスク優先順位(legal_medical_ad_privacy→booking_failure→clinic_info_mismatch→ai_crawler_failure)が、医療広告AIチェック由来の候補を含めても維持される", () => {
    // WEB_BOOKING/MEO/SEOを0点にしてbooking_failure・clinic_info_mismatch・ai_crawler_failureの
    // 各エスカレーションを発火させつつ、医療広告AIチェックのlegal_medical_ad_privacy候補も合流させる
    const ratioByDomain: Partial<Record<DomainKey, number>> = { WEB_BOOKING: 0, MEO: 0, SEO: 0 };
    const breakdown = buildBreakdown(ratioByDomain);
    const finding = buildAdRiskFinding({ id: "priority-check", severity: "high", confidence: "high" });
    const scored = scoreImprovementCandidates(
      generateImprovementCandidates({ breakdown, questionResults: [], adComplianceFindings: [finding] })
    );
    const ranked = rankImprovementCandidates(scored);
    const escalationCategories = ranked.filter((c) => c.kind === "risk_escalation").map((c) => c.escalation!.category);
    const categoryIndices = escalationCategories.map((cat) => ESCALATION_CATEGORY_ORDER.indexOf(cat));
    for (let i = 1; i < categoryIndices.length; i++) {
      expect(categoryIndices[i]!).toBeGreaterThanOrEqual(categoryIndices[i - 1]!);
    }
    // legal_medical_ad_privacy(医療広告AIチェック由来)が最優先カテゴリとして先頭に来る
    expect(ranked[0]!.escalation?.category).toBe("legal_medical_ad_privacy");
    expect(ranked[0]!.key).toBe("ad-compliance-priority-check");
  });

  it("adComplianceFindingsを指定しない場合、既存動作(候補を生成しない)が維持される", () => {
    const breakdown = buildBreakdown({});
    const drafts = generateImprovementCandidates({ breakdown, questionResults: [] });
    expect(drafts).toEqual([]);
  });
});
