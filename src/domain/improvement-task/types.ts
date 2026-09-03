import type { DomainKey } from "../diagnosis/types";

export type ImpactLevel = "high" | "medium" | "low";

export interface ImprovementCandidate {
  title: string;
  domain: DomainKey;
  detectedFact: string; // 検出された事実
  patientImpact: string; // 患者・集患への影響
  recommendedAction: string; // 修正手順
  impact: ImpactLevel;
  confidence: ImpactLevel;
  urgency: ImpactLevel;
  evidence: string[];
}
