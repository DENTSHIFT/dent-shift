import { describe, expect, it } from "vitest";
import { buildDashboardViewModel, type DashboardDiagnosisSummary } from "@/app/dashboard/dashboardViewModel";
import type { DiagnosisResultData } from "@/app/diagnosis/result/[id]/resultViewModel";
import type { DomainScore } from "@/domain/diagnosis/types";

function domain(domainKey: DomainScore["domain"]): DomainScore {
  return {
    domain: domainKey,
    maxPoints:
      domainKey === "AIO"
        ? 30
        : domainKey === "MEO"
          ? 20
          : domainKey === "WEB_BOOKING" || domainKey === "REVIEWS"
            ? 10
            : 15,
    assessedMaxPoints: 10,
    points: 8,
    coverage: 1,
    status: "estimated",
    criteria: [],
  };
}

function diagnosis(overrides: Partial<DiagnosisResultData> = {}): DiagnosisResultData {
  return {
    clinicId: "clinic-1",
    clinicName: "テスト歯科",
    clinicUrl: "https://example.test",
    totalPoints: 72,
    totalStatus: "estimated",
    scoreBreakdown: {
      domains: ["AIO", "MEO", "SEO", "LLMO", "WEB_BOOKING", "REVIEWS"].map((key) =>
        domain(key as DomainScore["domain"])
      ),
      maxPoints: 100,
      assessedMaxPoints: 100,
      coverage: 1,
    },
    competitors: [],
    aiObservations: [],
    questionResults: [
      {
        question: "質問1",
        status: "win",
        evidence: [],
        unavailableReason: null,
        competitorDifference: [],
        rootCauseKey: null,
        rootCauseLabel: null,
        confidence: null,
        sourceType: null,
        provisional: false,
        attributionStatus: "not_applicable",
        analysisVersion: null,
      },
      {
        question: "質問2",
        status: "lose",
        evidence: [],
        unavailableReason: null,
        competitorDifference: [],
        rootCauseKey: null,
        rootCauseLabel: null,
        confidence: null,
        sourceType: null,
        provisional: false,
        attributionStatus: "insufficient_evidence",
        analysisVersion: null,
      },
      {
        question: "質問3",
        status: "insufficient_data",
        evidence: [],
        unavailableReason: "insufficient_data",
        competitorDifference: [],
        rootCauseKey: null,
        rootCauseLabel: null,
        confidence: null,
        sourceType: null,
        provisional: false,
        attributionStatus: "not_applicable",
        analysisVersion: null,
      },
    ],
    topImprovements: [],
    adComplianceChecks: { findings: [], disclaimer: "", checkedAt: "2026-09-09T00:00:00.000Z" },
    isSample: true,
    dataDisclaimer: "参考データを含みます。",
    measuredAt: "2026-09-09T00:00:00.000Z",
    ...overrides,
  };
}

function summary(overrides: Partial<DashboardDiagnosisSummary> = {}): DashboardDiagnosisSummary {
  return {
    id: "latest",
    totalPoints: 72,
    totalStatus: "estimated",
    measuredAt: "2026-09-09T00:00:00.000Z",
    isSample: true,
    ...overrides,
  };
}

describe("buildDashboardViewModel", () => {
  it("診断がない場合は空状態を返す", () => {
    expect(buildDashboardViewModel(null, [])).toEqual({ hasDiagnosis: false, history: [] });
  });

  it("質問ステータスを中立な4区分の件数へ集計する", () => {
    const vm = buildDashboardViewModel({ id: "latest", diagnosis: diagnosis() }, [summary()]);
    expect(vm.hasDiagnosis).toBe(true);
    if (!vm.hasDiagnosis) throw new Error("expected diagnosis");
    expect(vm.questionSummary).toEqual({
      displayGood: 1,
      comparable: 0,
      needsImprovement: 1,
      insufficientData: 1,
    });
  });

  it("同条件のサンプル同士は参考値として前回比を表示する", () => {
    const vm = buildDashboardViewModel(
      { id: "latest", diagnosis: diagnosis({ totalPoints: 72 }) },
      [summary(), summary({ id: "previous", totalPoints: 68 })]
    );
    expect(vm.hasDiagnosis).toBe(true);
    if (!vm.hasDiagnosis) throw new Error("expected diagnosis");
    expect(vm.trend).toEqual({ label: "参考値の前回比 +4", tone: "positive" });
  });

  it("サンプルと実測が混在する場合は点数差を改善として表示しない", () => {
    const vm = buildDashboardViewModel(
      { id: "latest", diagnosis: diagnosis({ isSample: false }) },
      [summary({ isSample: false }), summary({ id: "previous", isSample: true, totalPoints: 50 })]
    );
    expect(vm.hasDiagnosis).toBe(true);
    if (!vm.hasDiagnosis) throw new Error("expected diagnosis");
    expect(vm.trend).toEqual({ label: "測定条件が異なるため比較なし", tone: "neutral" });
  });

  it("取得不能なスコアは前回比を算出しない", () => {
    const vm = buildDashboardViewModel(
      { id: "latest", diagnosis: diagnosis({ totalStatus: "unavailable" }) },
      [summary({ totalStatus: "unavailable" }), summary({ id: "previous", totalPoints: 60 })]
    );
    expect(vm.hasDiagnosis).toBe(true);
    if (!vm.hasDiagnosis) throw new Error("expected diagnosis");
    expect(vm.trend.label).toBe("取得状況により比較できません");
  });

  it("previous未指定の場合、domainTrendsは空配列(再診断ループ実装前の呼び出し元と後方互換)", () => {
    const vm = buildDashboardViewModel({ id: "latest", diagnosis: diagnosis() }, [summary()]);
    expect(vm.hasDiagnosis).toBe(true);
    if (!vm.hasDiagnosis) throw new Error("expected diagnosis");
    expect(vm.domainTrends).toEqual([]);
  });

  it("2026-09-29追加: AIO/LLMOが両方measuredなら領域単位の前回比を返し、測定日時も保持する", () => {
    const overrideDomains = (points: number) => ({
      domains: ["AIO", "MEO", "SEO", "LLMO", "WEB_BOOKING", "REVIEWS"].map((key) => ({
        ...domain(key as DomainScore["domain"]),
        status: "measured" as const,
        points: key === "AIO" ? points : 5,
      })),
      maxPoints: 100,
      assessedMaxPoints: 100,
      coverage: 1,
    });
    const latestDiag = diagnosis({
      isSample: false,
      measuredAt: "2026-09-29T09:00:00.000Z",
      scoreBreakdown: overrideDomains(10),
    });
    const previousDiag = diagnosis({
      isSample: false,
      measuredAt: "2026-09-20T09:00:00.000Z",
      scoreBreakdown: overrideDomains(4),
    });
    const vm = buildDashboardViewModel(
      { id: "latest", diagnosis: latestDiag },
      [summary({ isSample: false }), summary({ id: "previous", isSample: false, totalPoints: 20 })],
      { id: "previous", diagnosis: previousDiag }
    );
    expect(vm.hasDiagnosis).toBe(true);
    if (!vm.hasDiagnosis) throw new Error("expected diagnosis");
    const aioTrend = vm.domainTrends.find((t) => t.domain === "AIO");
    expect(aioTrend?.trend).toEqual({ label: "前回比 +6", tone: "positive" });
    expect(aioTrend?.latestMeasuredAt).toBe("2026-09-29T09:00:00.000Z");
    expect(aioTrend?.previousMeasuredAt).toBe("2026-09-20T09:00:00.000Z");
  });

  it("2026-09-30追加: AIO/LLMOが両方measuredでスコアが下がった場合、負の前回比(negative)を返す", () => {
    const overrideDomains = (points: number) => ({
      domains: ["AIO", "MEO", "SEO", "LLMO", "WEB_BOOKING", "REVIEWS"].map((key) => ({
        ...domain(key as DomainScore["domain"]),
        status: "measured" as const,
        points: key === "AIO" ? points : 5,
      })),
      maxPoints: 100,
      assessedMaxPoints: 100,
      coverage: 1,
    });
    const latestDiag = diagnosis({
      isSample: false,
      measuredAt: "2026-09-29T09:00:00.000Z",
      scoreBreakdown: overrideDomains(4),
    });
    const previousDiag = diagnosis({
      isSample: false,
      measuredAt: "2026-09-20T09:00:00.000Z",
      scoreBreakdown: overrideDomains(10),
    });
    const vm = buildDashboardViewModel(
      { id: "latest", diagnosis: latestDiag },
      [summary({ isSample: false }), summary({ id: "previous", isSample: false, totalPoints: 20 })],
      { id: "previous", diagnosis: previousDiag }
    );
    expect(vm.hasDiagnosis).toBe(true);
    if (!vm.hasDiagnosis) throw new Error("expected diagnosis");
    const aioTrend = vm.domainTrends.find((t) => t.domain === "AIO");
    expect(aioTrend?.trend).toEqual({ label: "前回比 -6", tone: "negative" });
  });

  it("2026-09-29追加: 片方の領域がunavailableなら、その領域は0点扱いで差分計算せずdomainTrendsから除外する", () => {
    const latestDiag = diagnosis({
      isSample: false,
      scoreBreakdown: {
        domains: ["AIO", "MEO", "SEO", "LLMO", "WEB_BOOKING", "REVIEWS"].map((key) => ({
          ...domain(key as DomainScore["domain"]),
          status: key === "AIO" ? ("unavailable" as const) : ("measured" as const),
          score: key === "AIO" ? null : undefined,
          points: key === "AIO" ? 0 : 5,
        })),
        maxPoints: 100,
        assessedMaxPoints: 100,
        coverage: 1,
      },
    });
    const previousDiag = diagnosis({ isSample: false });
    const vm = buildDashboardViewModel(
      { id: "latest", diagnosis: latestDiag },
      [summary({ isSample: false }), summary({ id: "previous", isSample: false })],
      { id: "previous", diagnosis: previousDiag }
    );
    expect(vm.hasDiagnosis).toBe(true);
    if (!vm.hasDiagnosis) throw new Error("expected diagnosis");
    expect(vm.domainTrends.find((t) => t.domain === "AIO")).toBeUndefined();
  });
});
