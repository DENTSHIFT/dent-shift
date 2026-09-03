import type { CompetitorClinic } from "@/domain/competitor/types";

export interface CompetitorProvider {
  readonly name: string;
  findNearbyCompetitors(clinicName: string, clinicUrl: string): Promise<CompetitorClinic[]>;
}
