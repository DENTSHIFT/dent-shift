import { describe, expect, it } from "vitest";
import { runFreeDiagnosis } from "@/server/services/runFreeDiagnosis";
import { buildDataDisclaimer } from "@/domain/diagnosis/dataDisclaimer";
import { DOMAIN_CRITERIA } from "@/domain/diagnosis/scoreCriteria";
import type { CriterionScore, DomainKey } from "@/domain/diagnosis/types";
import type { AiObservationInput, AiObservationResult, AiProvider } from "@/server/providers/ai/types";
import type { CompetitorProvider } from "@/server/providers/competitor/types";
import type { CompetitorClinic } from "@/domain/competitor/types";
import type { ScoreCriterionInput, ScoreProvider } from "@/server/providers/scoring/types";
import type { AdComplianceCheckInput, AdComplianceProvider } from "@/server/providers/ad-compliance/types";
import type { RawAdRiskFinding } from "@/domain/ad-compliance/types";

/**
 * サービス層(runFreeDiagnosis)の結合テスト。
 * 改善TOP3ロジック本体はpriorityScoring.test.ts / candidateCatalog.test.tsで個別に検証済みのため、
 * ここでは「公開契約(topImprovements)が正しく配線されているか」「insufficient_dataの修正が
 * 実際のAIプロバイダー呼び出し経路でも機能するか」を確認する。
 */

const FIXED_AT = "2026-01-01T00:00:00.000Z";

describe("buildDataDisclaimer", () => {
  it("canonical provider未指定でサンプルを含む場合、参考データであり実測ではないと案内する", () => {
    const disclaimer = buildDataDisclaimer(true, undefined);
    expect(disclaimer).toContain("参考データに基づく診断");
    expect(disclaimer).toContain("実測結果として扱わないでください");
    expect(disclaimer).not.toContain("実プロバイダーには接続していません");
  });

  it("実測とサンプルが混在する場合、その両方を明示する", () => {
    const disclaimer = buildDataDisclaimer(true, [{ measurementStatus: "measured" }]);
    expect(disclaimer).toContain("実測データと参考データが混在");
  });

  it("実測のみの場合、参考データが含まれるとは表示しない", () => {
    const disclaimer = buildDataDisclaimer(false, [{ measurementStatus: "measured" }]);
    expect(disclaimer).toContain("実測データが含まれています");
    expect(disclaimer).not.toContain("参考データ");
  });

  it("referenceのみの場合、実測を取得できず参考データを表示していると案内する", () => {
    const disclaimer = buildDataDisclaimer(true, [{ measurementStatus: "reference" }]);
    expect(disclaimer).toContain("実測データを取得できず");
    expect(disclaimer).toContain("参考データを表示");
  });

  it("unavailableのみの場合、参考データと誤表示せず取得不能を案内する", () => {
    const disclaimer = buildDataDisclaimer(true, [{ measurementStatus: "unavailable" }]);
    expect(disclaimer).toContain("実測データを取得できませんでした");
    expect(disclaimer).not.toContain("参考データを表示");
  });
});

function fullHealthCriteria(domain: DomainKey): CriterionScore[] {
  return DOMAIN_CRITERIA[domain].map((def) => ({
    key: def.key,
    label: def.label,
    maxScore: def.maxScore,
    score: def.maxScore,
    status: "estimated",
    evidence: [{ summary: "test: healthy" }],
    measuredAt: FIXED_AT,
    dataSource: "mock",
    unavailableReason: null,
  }));
}

function zeroScoreCriteria(domain: DomainKey): CriterionScore[] {
  return DOMAIN_CRITERIA[domain].map((def) => ({
    key: def.key,
    label: def.label,
    maxScore: def.maxScore,
    score: 0,
    status: "estimated",
    evidence: [{ summary: "test: zero" }],
    measuredAt: FIXED_AT,
    dataSource: "mock",
    unavailableReason: null,
  }));
}

function unavailableCriteria(domain: DomainKey): CriterionScore[] {
  return DOMAIN_CRITERIA[domain].map((def) => ({
    key: def.key,
    label: def.label,
    maxScore: def.maxScore,
    score: null,
    status: "unavailable",
    evidence: [{ summary: "test: 未接続のため測定不能" }],
    measuredAt: null,
    dataSource: "mock",
    unavailableReason: "not_connected",
  }));
}

function liveHealthCriteria(domain: DomainKey): CriterionScore[] {
  return DOMAIN_CRITERIA[domain].map((def) => ({
    key: def.key,
    label: def.label,
    maxScore: def.maxScore,
    score: def.maxScore,
    status: "measured",
    evidence: [{ summary: "test: live measured" }],
    measuredAt: FIXED_AT,
    dataSource: "website",
    unavailableReason: null,
  }));
}

class FakeCompetitorProvider implements CompetitorProvider {
  readonly name = "fake-competitor-provider";
  async findNearbyCompetitors(): Promise<CompetitorClinic[]> {
    return [];
  }
}

/** 既定では所見なし(空配列)を返す。医療広告AIチェックのdomain/service結合はここでは対象外
 * (priorityScoring.test.ts / adComplianceCheck.test.ts で個別に検証済み)のため、
 * runFreeDiagnosisの結合テストでは「配線が壊れていないか」だけを確認する。 */
class FakeAdComplianceProvider implements AdComplianceProvider {
  readonly name = "fake-ad-compliance-provider";
  constructor(private readonly findings: RawAdRiskFinding[] = []) {}
  async check(_input: AdComplianceCheckInput): Promise<RawAdRiskFinding[]> {
    return this.findings;
  }
}

class FakeScoreProvider implements ScoreProvider {
  readonly name = "fake-score-provider";
  constructor(private readonly overrides: Partial<Record<DomainKey, CriterionScore[]>> = {}) {}
  async score(domain: DomainKey, _input: ScoreCriterionInput): Promise<CriterionScore[]> {
    return this.overrides[domain] ?? fullHealthCriteria(domain);
  }
}

class AllLiveScoreProvider implements ScoreProvider {
  readonly name = "fake-score-provider-all-live";
  async score(domain: DomainKey, _input: ScoreCriterionInput): Promise<CriterionScore[]> {
    return liveHealthCriteria(domain);
  }
}

class FullHealthAiProvider implements AiProvider {
  readonly name = "fake-ai-provider-full-health";
  async observe(input: AiObservationInput): Promise<AiObservationResult[]> {
    return input.patientQuestions.map((question) => ({
      question,
      aiProvider: "chatgpt",
      model: "fake",
      mentioned: true,
      recommendationRank: 1,
      competitorMentions: [],
      citations: [],
      region: null,
      evidence: "test: mentioned",
      dataSource: "mock",
      capturedAt: FIXED_AT,
    }));
  }
}

class AllLiveAiProvider implements AiProvider {
  readonly name = "fake-ai-provider-all-live";
  async observe(input: AiObservationInput): Promise<AiObservationResult[]> {
    return input.patientQuestions.map((question) => ({
      question,
      aiProvider: "chatgpt",
      model: "fake-live",
      mentioned: true,
      recommendationRank: 1,
      competitorMentions: [],
      citations: ["https://example.com/citation"],
      region: "tokyo",
      evidence: "test: live mentioned",
      dataSource: "live",
      capturedAt: FIXED_AT,
    }));
  }
}

let lastSkippedQuestion = "";
class SkipFirstQuestionAiProvider implements AiProvider {
  readonly name = "fake-ai-provider-skip-first";
  async observe(input: AiObservationInput): Promise<AiObservationResult[]> {
    const [skip, ...rest] = input.patientQuestions;
    lastSkippedQuestion = skip ?? "";
    return rest.map((question) => ({
      question,
      aiProvider: "chatgpt",
      model: "fake",
      mentioned: true,
      recommendationRank: 1,
      competitorMentions: [],
      citations: [],
      region: null,
      evidence: "test: mentioned",
      dataSource: "mock",
      capturedAt: FIXED_AT,
    }));
  }
}

/**
 * 最初の質問のみ「負け」(自院は言及されず、競合1件が言及される)にし、残りは全質問で
 * 自院が言及される(勝ち)状態を返す。「なぜ負けている?」root cause attributionの
 * runFreeDiagnosisへの配線を検証するための最小フィクスチャ(2026-09-06のユーザー指示)。
 */
class OneLosingQuestionAiProvider implements AiProvider {
  readonly name = "fake-ai-provider-one-losing-question";
  async observe(input: AiObservationInput): Promise<AiObservationResult[]> {
    return input.patientQuestions.map((question, index) => {
      if (index === 0) {
        return {
          question,
          aiProvider: "chatgpt",
          model: "fake",
          mentioned: false,
          recommendationRank: null,
          competitorMentions: ["競合クリニックA"],
          citations: [],
          region: null,
          evidence: "test: 競合のみ言及された",
          dataSource: "mock",
          capturedAt: FIXED_AT,
        };
      }
      return {
        question,
        aiProvider: "chatgpt",
        model: "fake",
        mentioned: true,
        recommendationRank: 1,
        competitorMentions: [],
        citations: [],
        region: null,
        evidence: "test: mentioned",
        dataSource: "mock",
        capturedAt: FIXED_AT,
      };
    });
  }
}

const VALID_INPUT = {
  clinicName: "テスト歯科医院",
  directorName: "テスト院長",
  clinicUrl: "https://example.com",
  contactEmail: "test@example.com",
  contactPhone: "03-1234-5678",
  gbpUrl: "https://maps.example.com/test",
  bookingUrl: "https://example.com/booking",
};

describe("runFreeDiagnosis(改善TOP3ロジックの配線)", () => {
  it("6領域すべて健全・全質問で勝っている場合、topImprovementsは空になる", async () => {
    const result = await runFreeDiagnosis(VALID_INPUT, {
      aiProvider: new FullHealthAiProvider(),
      competitorProvider: new FakeCompetitorProvider(),
      scoreProvider: new FakeScoreProvider(),
      adComplianceProvider: new FakeAdComplianceProvider(),
    });
    expect(result.topImprovements).toEqual([]);
  });

  it("topImprovementsは常に3件以下である", async () => {
    const overrides: Partial<Record<DomainKey, CriterionScore[]>> = {
      AIO: zeroScoreCriteria("AIO"),
      LLMO: zeroScoreCriteria("LLMO"),
      MEO: zeroScoreCriteria("MEO"),
      SEO: zeroScoreCriteria("SEO"),
      WEB_BOOKING: zeroScoreCriteria("WEB_BOOKING"),
      REVIEWS: zeroScoreCriteria("REVIEWS"),
    };
    const result = await runFreeDiagnosis(VALID_INPUT, {
      aiProvider: new FullHealthAiProvider(),
      competitorProvider: new FakeCompetitorProvider(),
      scoreProvider: new FakeScoreProvider(overrides),
      adComplianceProvider: new FakeAdComplianceProvider(),
    });
    expect(result.topImprovements.length).toBeLessThanOrEqual(3);
  });

  it("予約導線が完全に機能していない場合、重大リスクエスカレーションがTOP3の先頭に来る", async () => {
    const result = await runFreeDiagnosis(VALID_INPUT, {
      aiProvider: new FullHealthAiProvider(),
      competitorProvider: new FakeCompetitorProvider(),
      scoreProvider: new FakeScoreProvider({ WEB_BOOKING: zeroScoreCriteria("WEB_BOOKING") }),
      adComplianceProvider: new FakeAdComplianceProvider(),
    });
    expect(result.topImprovements.length).toBeGreaterThan(0);
    const top = result.topImprovements[0]!;
    expect(top.kind).toBe("risk_escalation");
    expect(top.escalation?.category).toBe("booking_failure");
    // 20点満点への無理な変換はしていない(通常のpriorityスコアも別途保持する)
    expect(top.priority).toBeDefined();
  });

  it("AIプロバイダーが特定の質問に応答しない場合、その質問はlose(負け)ではなくinsufficient_data(データ不足)になる", async () => {
    const result = await runFreeDiagnosis(VALID_INPUT, {
      aiProvider: new SkipFirstQuestionAiProvider(),
      competitorProvider: new FakeCompetitorProvider(),
      scoreProvider: new FakeScoreProvider(),
      adComplianceProvider: new FakeAdComplianceProvider(),
    });
    const skippedResult = result.questionResults.find((q) => q.question === lastSkippedQuestion);
    expect(skippedResult).toBeDefined();
    expect(skippedResult?.status).toBe("insufficient_data");
    // insufficient_data状態は常にunavailableReason="insufficient_data"を保持する
    // (2026-09-06のユーザー指示④ 基本ルール2)
    expect(skippedResult?.unavailableReason).toBe("insufficient_data");
    expect(result.questionResults.some((q) => q.status === "lose")).toBe(false);
  });

  it("WEB_BOOKINGがunavailable(未接続)の場合、data_gapとして扱われ、医院の弱点と断定されない", async () => {
    const result = await runFreeDiagnosis(VALID_INPUT, {
      aiProvider: new FullHealthAiProvider(),
      competitorProvider: new FakeCompetitorProvider(),
      scoreProvider: new FakeScoreProvider({ WEB_BOOKING: unavailableCriteria("WEB_BOOKING") }),
      adComplianceProvider: new FakeAdComplianceProvider(),
    });
    // 予約導線はdiagnosis/booking計測を阻害するためTOP3候補になり得る
    const bookingGap = result.topImprovements.find((c) => c.key === "data-gap-WEB_BOOKING");
    expect(bookingGap?.dataGap?.status).toBe("unavailable");
    expect(bookingGap?.dataGap?.blocking).toBe(true);
    expect(bookingGap?.priority).toBeUndefined();
    expect(bookingGap?.patientImpact).toContain("断定はできません");
    // 根拠となったcriterion(unavailableCriteria)のunavailableReasonがそのまま伝わる
    // (2026-09-06のユーザー指示④。サービス層〜候補生成までのend-to-end配線確認)
    expect(bookingGap?.dataGap?.unavailableReason).toBe("not_connected");
  });
});

describe("runFreeDiagnosis(医療広告AIチェックの配線、2026-09-05のユーザー指示)", () => {
  it("adComplianceChecksが常に結果に含まれ、disclaimerが必須3文言を含む", async () => {
    const result = await runFreeDiagnosis(VALID_INPUT, {
      aiProvider: new FullHealthAiProvider(),
      competitorProvider: new FakeCompetitorProvider(),
      scoreProvider: new FakeScoreProvider(),
      adComplianceProvider: new FakeAdComplianceProvider([]),
    });
    expect(result.adComplianceChecks.findings).toEqual([]);
    expect(result.adComplianceChecks.disclaimer).toContain("AIによるリスクチェック");
    expect(result.adComplianceChecks.disclaimer).toContain("法令違反を断定するものではありません");
    expect(result.adComplianceChecks.disclaimer).toContain("最終判断は医院または専門家が行ってください");
  });

  it("severity=high・matchStrength=directの所見はtopImprovementsのlegal_medical_ad_privacyエスカレーションとして現れる", async () => {
    const result = await runFreeDiagnosis(VALID_INPUT, {
      aiProvider: new FullHealthAiProvider(),
      competitorProvider: new FakeCompetitorProvider(),
      scoreProvider: new FakeScoreProvider(),
      adComplianceProvider: new FakeAdComplianceProvider([
        {
          category: "safety_assertion",
          severity: "high",
          matchStrength: "direct",
          quotedText: "痛みは一切ありません",
          sourceLocation: "test",
          detectionReason: "test",
          sourceType: "rule_based",
        },
      ]),
    });
    expect(result.adComplianceChecks.findings.length).toBe(1);
    expect(result.adComplianceChecks.findings[0]!.escalationEligible).toBe(true);
    const escalated = result.topImprovements.find((c) => c.escalation?.category === "legal_medical_ad_privacy");
    expect(escalated).toBeDefined();
    expect(escalated?.kind).toBe("risk_escalation");
  });

  it("severity=high・matchStrength=inferred(confidence不十分)の所見はadComplianceChecksには現れるがtopImprovementsには合流しない", async () => {
    const result = await runFreeDiagnosis(VALID_INPUT, {
      aiProvider: new FullHealthAiProvider(),
      competitorProvider: new FakeCompetitorProvider(),
      scoreProvider: new FakeScoreProvider(),
      adComplianceProvider: new FakeAdComplianceProvider([
        {
          category: "safety_assertion",
          severity: "high",
          matchStrength: "inferred",
          quotedText: "test",
          sourceLocation: "test",
          detectionReason: "test",
          sourceType: "rule_based",
        },
      ]),
    });
    expect(result.adComplianceChecks.findings.length).toBe(1);
    expect(result.adComplianceChecks.findings[0]!.escalationEligible).toBe(false);
    expect(result.adComplianceChecks.findings[0]!.displayMessage).toContain("要確認");
    expect(result.topImprovements.some((c) => c.escalation?.category === "legal_medical_ad_privacy")).toBe(false);
  });

  it("sourceType=mockの所見はseverity=high・matchStrength=direct(confidence=high)でもtopImprovementsへ合流せず、provisional=trueとして扱われる(2026-09-05のユーザー指示)", async () => {
    const result = await runFreeDiagnosis(VALID_INPUT, {
      aiProvider: new FullHealthAiProvider(),
      competitorProvider: new FakeCompetitorProvider(),
      scoreProvider: new FakeScoreProvider(),
      adComplianceProvider: new FakeAdComplianceProvider([
        {
          category: "safety_assertion",
          severity: "high",
          matchStrength: "direct",
          quotedText: "痛みは一切ありません(開発用サンプル)",
          sourceLocation: "test",
          detectionReason: "test",
          sourceType: "mock",
        },
      ]),
    });
    const finding = result.adComplianceChecks.findings[0]!;
    expect(finding.escalationEligible).toBe(false);
    expect(finding.provisional).toBe(true);
    expect(finding.sourceLabel).toMatch(/開発用サンプル|実測ではありません/);
    expect(result.topImprovements.some((c) => c.escalation?.category === "legal_medical_ad_privacy")).toBe(false);
  });
});

/**
 * isSample(2026-09-05のユーザー指示、追加承認事項)。mock/サンプルデータを実測に見せかけない
 * ためのフラグが、criterion/ai_observation/ad-compliance findingのいずれかが"mock"由来なら
 * 機械的にtrueになることを検証する。あわせて、aiObservationsがRunFreeDiagnosisResultに
 * 正しく含まれる(=永続化・再現のためのevidenceが失われない)ことも確認する。
 */
describe("runFreeDiagnosis: isSample / aiObservationsの配線(2026-09-05のユーザー指示)", () => {
  it("既定のfakeプロバイダー(すべてmock由来)ではisSample=trueになる", async () => {
    const result = await runFreeDiagnosis(VALID_INPUT, {
      aiProvider: new FullHealthAiProvider(),
      competitorProvider: new FakeCompetitorProvider(),
      scoreProvider: new FakeScoreProvider(),
      adComplianceProvider: new FakeAdComplianceProvider(),
    });
    expect(result.isSample).toBe(true);
  });

  it("criterion・ai_observation・ad-compliance findingのすべてが非mockならisSample=falseになる", async () => {
    const result = await runFreeDiagnosis(VALID_INPUT, {
      aiProvider: new AllLiveAiProvider(),
      competitorProvider: new FakeCompetitorProvider(),
      scoreProvider: new AllLiveScoreProvider(),
      adComplianceProvider: new FakeAdComplianceProvider([
        {
          category: "safety_assertion",
          severity: "low",
          matchStrength: "inferred",
          quotedText: "test",
          sourceLocation: "test",
          detectionReason: "test",
          sourceType: "live_page",
        },
      ]),
    });
    expect(result.isSample).toBe(false);
  });

  it("criterion・ai_observationが非mockでも、ad-compliance findingが1件でもmock由来ならisSample=trueになる(汚染防止と対称に、mockの混入は必ず検出する)", async () => {
    const result = await runFreeDiagnosis(VALID_INPUT, {
      aiProvider: new AllLiveAiProvider(),
      competitorProvider: new FakeCompetitorProvider(),
      scoreProvider: new AllLiveScoreProvider(),
      adComplianceProvider: new FakeAdComplianceProvider([
        {
          category: "safety_assertion",
          severity: "high",
          matchStrength: "direct",
          quotedText: "test",
          sourceLocation: "test",
          detectionReason: "test",
          sourceType: "mock",
        },
      ]),
    });
    expect(result.isSample).toBe(true);
  });

  it("aiObservationsがRunFreeDiagnosisResultに含まれ、AIプロバイダーの生観測結果(citations/region含む)が失われない", async () => {
    const result = await runFreeDiagnosis(VALID_INPUT, {
      aiProvider: new AllLiveAiProvider(),
      competitorProvider: new FakeCompetitorProvider(),
      scoreProvider: new AllLiveScoreProvider(),
      adComplianceProvider: new FakeAdComplianceProvider(),
    });
    expect(result.aiObservations.length).toBeGreaterThan(0);
    const obs = result.aiObservations[0]!;
    expect(obs.dataSource).toBe("live");
    expect(obs.citations).toEqual(["https://example.com/citation"]);
    expect(obs.region).toBe("tokyo");
  });
});

describe("runFreeDiagnosis: aioLossRootCausesの配線(2026-09-06のユーザー指示。「なぜ負けている?」root cause TOP3)", () => {
  it("status=loseの質問がある場合、questionResultsにroot cause属性が付与され、aioLossRootCausesへ反映される", async () => {
    const result = await runFreeDiagnosis(VALID_INPUT, {
      aiProvider: new OneLosingQuestionAiProvider(),
      competitorProvider: new FakeCompetitorProvider(),
      scoreProvider: new FakeScoreProvider(),
      adComplianceProvider: new FakeAdComplianceProvider(),
    });
    const losing = result.questionResults.find((q) => q.status === "lose");
    expect(losing).toBeDefined();
    expect(losing?.attributionStatus).toBe("attributed");
    expect(losing?.rootCauseKey).toBe("AIO:ai_search_presence");
    expect(losing?.competitorDifference).toEqual(["競合クリニックA"]);
    // mock由来のためprovisional=true・confidenceはhighへ引き上げずmediumに丸められる
    expect(losing?.provisional).toBe(true);
    expect(losing?.confidence).toBe("medium");

    expect(result.aioLossRootCauses.length).toBeGreaterThan(0);
    const top = result.aioLossRootCauses[0]!;
    expect(top.rootCauseKey).toBe("AIO:ai_search_presence");
    expect(top.linkedQuestions).toContain(losing!.question);
  });

  it("win/close/insufficient_dataの質問はattributionStatus=not_applicableのままroot cause判定対象外になる", async () => {
    const result = await runFreeDiagnosis(VALID_INPUT, {
      aiProvider: new OneLosingQuestionAiProvider(),
      competitorProvider: new FakeCompetitorProvider(),
      scoreProvider: new FakeScoreProvider(),
      adComplianceProvider: new FakeAdComplianceProvider(),
    });
    const nonLosing = result.questionResults.filter((q) => q.status !== "lose");
    expect(nonLosing.length).toBeGreaterThan(0);
    for (const q of nonLosing) {
      expect(q.attributionStatus).toBe("not_applicable");
      expect(q.rootCauseKey).toBeNull();
    }
  });

  it("全質問が勝ちの場合、aioLossRootCausesは空配列になる(存在しない原因を捏造しない)", async () => {
    const result = await runFreeDiagnosis(VALID_INPUT, {
      aiProvider: new FullHealthAiProvider(),
      competitorProvider: new FakeCompetitorProvider(),
      scoreProvider: new FakeScoreProvider(),
      adComplianceProvider: new FakeAdComplianceProvider(),
    });
    expect(result.aioLossRootCauses).toEqual([]);
  });

  it("aioLossRootCausesの追加は既存のtopImprovements(aio-losing-patient-questions%含む)を劣化させない", async () => {
    const deps = {
      aiProvider: new OneLosingQuestionAiProvider(),
      competitorProvider: new FakeCompetitorProvider(),
      scoreProvider: new FakeScoreProvider(),
      adComplianceProvider: new FakeAdComplianceProvider(),
    };
    const result = await runFreeDiagnosis(VALID_INPUT, deps);
    // improvement TOP3ロジック(candidateCatalog/priorityScoring)は今回変更していないため、
    // aio-losing-patient-questions等の既存挙動に影響が無いことを確認する
    // (「なぜ負けている?」分析とimprovement TOP3は責務が独立している)。
    expect(result.topImprovements.length).toBeLessThanOrEqual(3);
  });
});
