import { describe, expect, it } from "vitest";
import type { ImprovementCandidate } from "@/domain/improvement-task/types";
import { mapImprovementCandidateToInstructionPdfItem } from "@/domain/options/instructionPdfContentMapper";
import { NOT_AVAILABLE_LABEL } from "@/domain/options/instructionPdfContent";

const BASE_TASK: ImprovementCandidate = {
  title: "予約ページのAI Overviews対応",
  domain: "AIO",
  detectedFact: "予約ページに構造化データが存在しない",
  patientImpact: "AI検索経由の新規患者が予約導線を見つけにくい",
  recommendedAction: "予約ページにLocalBusiness構造化データを追加する",
  impact: "high",
  confidence: "high",
  urgency: "medium",
  evidence: ["予約ページのHTMLにJSON-LDが検出されなかった"],
  key: "aio-booking-structured-data",
  kind: "standard",
  recommendedAssignee: "制作会社",
  ruleKey: "aio-booking-structured-data",
  rootCauseKey: "AIO:booking_structured_data",
  evidenceDomain: "AIO",
  provisional: false,
  sourceCriteria: [{ domain: "AIO", criterionKey: "booking_structured_data" }],
  structuredEvidence: [],
  priority: {
    axes: { catchmentImpact: 4, urgency: 3, easeOfExecution: 4, rippleEffect: 3 },
    total: 14,
    tier: "priority",
  },
};

describe("mapImprovementCandidateToInstructionPdfItem", () => {
  it("実データが存在するフィールドはそのまま転記する", () => {
    const item = mapImprovementCandidateToInstructionPdfItem(BASE_TASK);
    expect(item.title).toBe(BASE_TASK.title);
    expect(item.currentProblem).toBe(BASE_TASK.detectedFact);
    expect(item.patientImpact).toBe(BASE_TASK.patientImpact);
    expect(item.fixSteps).toBe(BASE_TASK.recommendedAction);
    expect(item.recommendedAssignee).toBe(BASE_TASK.recommendedAssignee);
    expect(item.whyItMatters).toBe(BASE_TASK.evidence.join("／"));
    expect(item.priorityLabel).toBe("優先(14/20点)");
  });

  it("データモデルに存在しない項目(推奨文案/実装条件/完了条件/再診断条件)は常にNOT_AVAILABLE_LABELで、AI補完しない", () => {
    const item = mapImprovementCandidateToInstructionPdfItem(BASE_TASK);
    expect(item.recommendedCopy).toBe(NOT_AVAILABLE_LABEL);
    expect(item.implementationConditions).toBe(NOT_AVAILABLE_LABEL);
    expect(item.completionCriteria).toBe(NOT_AVAILABLE_LABEL);
    expect(item.remeasurementCriteria).toBe(NOT_AVAILABLE_LABEL);
  });

  it("evidenceが空配列なら、理由をでっちあげずNOT_AVAILABLE_LABELにする", () => {
    const item = mapImprovementCandidateToInstructionPdfItem({ ...BASE_TASK, evidence: [] });
    expect(item.whyItMatters).toBe(NOT_AVAILABLE_LABEL);
  });

  it("priorityが無くescalationがある場合(重大リスク)は、escalationから優先度ラベルを導出する", () => {
    const escalated: ImprovementCandidate = {
      ...BASE_TASK,
      kind: "risk_escalation",
      priority: undefined,
      escalation: {
        category: "booking_failure",
        severity: "critical",
        confidence: "high",
        reason: "予約フォームが送信エラーになる",
      },
    };
    const item = mapImprovementCandidateToInstructionPdfItem(escalated);
    expect(item.priorityLabel).toBe("重大リスク・重大");
  });

  it("priorityもescalationも無い場合はNOT_AVAILABLE_LABEL(架空の優先度を作らない)", () => {
    const noPriority: ImprovementCandidate = { ...BASE_TASK, priority: undefined };
    const item = mapImprovementCandidateToInstructionPdfItem(noPriority);
    expect(item.priorityLabel).toBe(NOT_AVAILABLE_LABEL);
  });
});
