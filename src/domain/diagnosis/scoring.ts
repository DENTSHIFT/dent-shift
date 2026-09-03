import type {
  DiagnosisScoreBreakdown,
  DomainKey,
  DomainScore,
  OverallScoreStatus,
} from "./types";

// 引き継ぎ書7章: AIO30 / MEO20 / SEO15 / LLMO15 / Web予約導線10 / 口コミ信頼性10 = 100点
export const DOMAIN_MAX_POINTS: Record<DomainKey, number> = {
  AIO: 30,
  MEO: 20,
  SEO: 15,
  LLMO: 15,
  WEB_BOOKING: 10,
  REVIEWS: 10,
};

export const DOMAIN_ORDER: DomainKey[] = [
  "AIO",
  "MEO",
  "SEO",
  "LLMO",
  "WEB_BOOKING",
  "REVIEWS",
];

export interface DomainScoreInput {
  domain: DomainKey;
  // 取得できなかった場合は points を渡さず status: "unavailable" のみ渡す
  points?: number;
  status: "measured" | "unavailable" | "estimated";
  evidence: string[];
}

export class InvalidDomainScoreError extends Error {}

/**
 * 6領域のスコアを集計する純粋関数。
 * - 取得不能(unavailable)は0点として扱わない(事業ルール3-11)
 * - 各domainの配点上限を超える入力はエラーとする
 * - 全domainが揃っていない入力はエラーとする(P0では6領域すべてを必ず評価する)
 */
export function calculateScoreBreakdown(
  inputs: DomainScoreInput[]
): DiagnosisScoreBreakdown {
  if (inputs.length !== DOMAIN_ORDER.length) {
    throw new InvalidDomainScoreError(
      `6領域すべての入力が必要です(受け取った件数: ${inputs.length})`
    );
  }

  const domains: DomainScore[] = DOMAIN_ORDER.map((domain) => {
    const input = inputs.find((i) => i.domain === domain);
    if (!input) {
      throw new InvalidDomainScoreError(`${domain} の入力がありません`);
    }

    const maxPoints = DOMAIN_MAX_POINTS[domain];

    if (input.status === "unavailable") {
      return {
        domain,
        maxPoints,
        points: null,
        status: "unavailable",
        evidence: input.evidence,
      };
    }

    if (input.points === undefined) {
      throw new InvalidDomainScoreError(
        `${domain}: status が measured/estimated の場合 points は必須です`
      );
    }
    if (input.points < 0 || input.points > maxPoints) {
      throw new InvalidDomainScoreError(
        `${domain}: points(${input.points}) が配点範囲(0〜${maxPoints})を超えています`
      );
    }

    return {
      domain,
      maxPoints,
      points: input.points,
      status: input.status,
      evidence: input.evidence,
    };
  });

  const measuredDomains = domains.filter((d) => d.points !== null);
  const totalPoints = measuredDomains.reduce(
    (sum, d) => sum + (d.points ?? 0),
    0
  );

  let totalStatus: OverallScoreStatus = "measured";
  if (domains.some((d) => d.status === "unavailable")) {
    totalStatus = "partial";
  } else if (domains.some((d) => d.status === "estimated")) {
    totalStatus = "estimated";
  }

  return {
    domains,
    totalPoints,
    totalStatus,
    measuredDomainCount: measuredDomains.length,
    totalDomainCount: domains.length,
  };
}

/** 各domainの達成率(0〜1)。unavailableはnullのまま返す(改善優先度づけの入力に使う) */
export function domainAchievementRate(score: DomainScore): number | null {
  if (score.points === null) return null;
  return score.points / score.maxPoints;
}
