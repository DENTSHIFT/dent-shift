// 6領域100点診断のドメイン型
// フレームワーク・DBに依存しない純粋な型定義(ARCHITECTURE.md 4章「Domain層」に対応)

export type DomainKey = "AIO" | "MEO" | "SEO" | "LLMO" | "WEB_BOOKING" | "REVIEWS";

// 取得不能な値を0として扱わない、という事業ルール(引き継ぎ書3章-11)を型で表現する
export type DomainScoreStatus = "measured" | "unavailable" | "estimated";

export interface DomainScore {
  domain: DomainKey;
  maxPoints: number;
  // status が "unavailable" のときは points は必ず null (0点として扱わない)
  points: number | null;
  status: DomainScoreStatus;
  evidence: string[];
}

export type OverallScoreStatus = "measured" | "partial" | "estimated";

export interface DiagnosisScoreBreakdown {
  domains: DomainScore[];
  // 取得できたdomainのみを合算した点数。未取得domainがある場合はtotalStatusが"partial"になる
  totalPoints: number;
  totalStatus: OverallScoreStatus;
  measuredDomainCount: number;
  totalDomainCount: number;
}
