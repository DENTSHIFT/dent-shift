import type { ImprovementCandidate, PriorityTier } from "@/domain/improvement-task/types";
import { NOT_AVAILABLE_LABEL, type InstructionPdfContent } from "./instructionPdfContent";

const TIER_LABELS: Record<PriorityTier, string> = {
  top: "最優先",
  priority: "優先",
  normal: "通常",
  monitor: "監視",
};

const ESCALATION_SEVERITY_LABELS: Record<string, string> = {
  critical: "重大",
  high: "高",
};

/**
 * ImprovementCandidateの14項目要求への対応関係(2026-09-22のユーザー指示):
 * - 医院名/対象URL/Report ID/Version/発行日時 → 呼び出し側(clinic/order/diagnosis)から直接
 * - タイトル → title、現状の問題 → detectedFact、患者・集患への影響 → patientImpact、
 *   具体的な修正手順 → recommendedAction、推奨担当者 → recommendedAssignee はそのまま存在
 * - 改善が必要な理由 → evidence配列を結合(evidenceが空ならデータなし)
 * - 優先度 → priority(4軸合計+tier)またはescalation(重大リスク)から導出
 * - 推奨文案/実装条件/完了条件/再診断条件 → 現行データモデルに存在しないため、
 *   AIによる架空の補完はせず、常にNOT_AVAILABLE_LABELを設定する
 *   (仕様書Ver1■「存在しない情報をAIで勝手に補完しない」)。
 */
export function mapImprovementCandidateToInstructionPdfItem(
  task: ImprovementCandidate
): InstructionPdfContent["item"] {
  const whyItMatters = task.evidence.length > 0 ? task.evidence.join("／") : NOT_AVAILABLE_LABEL;

  let priorityLabel = NOT_AVAILABLE_LABEL;
  if (task.priority) {
    priorityLabel = `${TIER_LABELS[task.priority.tier]}(${task.priority.total}/20点)`;
  } else if (task.escalation) {
    const severity = ESCALATION_SEVERITY_LABELS[task.escalation.severity] ?? task.escalation.severity;
    priorityLabel = `重大リスク・${severity}`;
  }

  return {
    title: task.title || NOT_AVAILABLE_LABEL,
    currentProblem: task.detectedFact || NOT_AVAILABLE_LABEL,
    whyItMatters,
    patientImpact: task.patientImpact || NOT_AVAILABLE_LABEL,
    fixSteps: task.recommendedAction || NOT_AVAILABLE_LABEL,
    recommendedCopy: NOT_AVAILABLE_LABEL,
    implementationConditions: NOT_AVAILABLE_LABEL,
    recommendedAssignee: task.recommendedAssignee || NOT_AVAILABLE_LABEL,
    priorityLabel,
    completionCriteria: NOT_AVAILABLE_LABEL,
    remeasurementCriteria: NOT_AVAILABLE_LABEL,
  };
}
