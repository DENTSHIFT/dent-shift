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
});
