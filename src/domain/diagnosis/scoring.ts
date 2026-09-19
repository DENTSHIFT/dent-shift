import { DOMAIN_CRITERIA, DOMAIN_ORDER, getDomainMaxPoints, getTotalMaxPoints } from "./scoreCriteria";
import type {
  CriterionScore,
  CriterionStatus,
  DiagnosisScoreBreakdown,
  DomainAggregateStatus,
  DomainKey,
  DomainScore,
} from "./types";

/**
 * 6領域スコアの集計ロジック(純粋関数のみ)。
 *
 * 重要: このファイルは「取得データ → 判定ルール → criterion score」までは関知しない。
 * その変換(乱数・ヒューリスティック等を含む)はすべて server/providers/scoring 配下の
 * provider実装の責務であり、domain層には一切の乱数・非決定的処理を持ち込まない。
 * ここではprovider/mockが既に算出したCriterionScore[]を、正本の配点ルールに沿って
 * 集計・検証するだけ。
 */

export class InvalidDomainScoreError extends Error {}

/**
 * 1領域分のcriterion結果を集計する。
 * - 取得不能(unavailable)なcriterionのscoreは合計に加算しない(0点扱いしない)
 * - 取得不能なcriterionのmaxScoreも「達成率」の分母(assessedMaxPoints)から除外する。
 *   つまり「一部取得不能だから残り項目だけで100点換算する」補正は行わない。
 *   maxPointsは常に正本の満点のまま固定し、assessedMaxPointsで「どれだけ測定できたか」を別軸として表現する。
 */
export function calculateDomainScore(domain: DomainKey, criteria: CriterionScore[]): DomainScore {
  const definitions = DOMAIN_CRITERIA[domain];
  const maxPoints = getDomainMaxPoints(domain);

  if (criteria.length !== definitions.length) {
    throw new InvalidDomainScoreError(
      `${domain}: ${definitions.length}件のcriterionが必要です(受け取った件数: ${criteria.length})`
    );
  }

  for (const def of definitions) {
    const c = criteria.find((c) => c.key === def.key);
    if (!c) {
      throw new InvalidDomainScoreError(`${domain}: criterion "${def.key}" の入力がありません`);
    }
    if (c.maxScore !== def.maxScore) {
      throw new InvalidDomainScoreError(
        `${domain}/${def.key}: maxScore(${c.maxScore})が正本の配点(${def.maxScore})と一致しません`
      );
    }
    if (c.status === "unavailable") {
      if (c.score !== null) {
        throw new InvalidDomainScoreError(`${domain}/${def.key}: unavailableなのにscoreがnullではありません`);
      }
      if (c.measuredAt !== null) {
        throw new InvalidDomainScoreError(`${domain}/${def.key}: unavailableなのにmeasuredAtがnullではありません`);
      }
      // 2026-09-06のユーザー指示④ 基本ルール1: unavailableになるデータは原則unavailableReasonを必須で持つ。
      if (c.unavailableReason === null) {
        throw new InvalidDomainScoreError(`${domain}/${def.key}: unavailableなのにunavailableReasonが設定されていません`);
      }
    } else {
      if (c.score === null || c.score < 0 || c.score > c.maxScore) {
        throw new InvalidDomainScoreError(
          `${domain}/${def.key}: score(${c.score})が配点範囲(0〜${c.maxScore})を超えています`
        );
      }
      // 2026-09-06のユーザー指示④ 基本ルール4: 正常に計測できた結果へunavailableReasonを付けない。
      if (c.unavailableReason !== null) {
        throw new InvalidDomainScoreError(
          `${domain}/${def.key}: status="${c.status}"なのにunavailableReasonが設定されています`
        );
      }
    }
  }

  const assessed = criteria.filter((c) => c.status !== "unavailable");
  const assessedMaxPoints = assessed.reduce((sum, c) => sum + c.maxScore, 0);
  const points = assessed.reduce((sum, c) => sum + (c.score ?? 0), 0);
  const coverage = maxPoints === 0 ? 0 : assessedMaxPoints / maxPoints;

  const status = deriveAggregateStatus(
    criteria.map((c) => c.status),
    assessedMaxPoints
  );

  return { domain, maxPoints, assessedMaxPoints, points, coverage, status, criteria };
}

/**
 * 6領域分のDomainScoreを最終的な100点満点の内訳へ集計する。
 */
export function calculateScoreBreakdown(domainScores: DomainScore[]): DiagnosisScoreBreakdown {
  if (domainScores.length !== DOMAIN_ORDER.length) {
    throw new InvalidDomainScoreError(
      `6領域すべての入力が必要です(受け取った件数: ${domainScores.length})`
    );
  }
  for (const domain of DOMAIN_ORDER) {
    if (!domainScores.some((d) => d.domain === domain)) {
      throw new InvalidDomainScoreError(`${domain} の入力がありません`);
    }
  }

  // 表示順は正本(診断ロジック仕様書§11)の AIO→LLMO→MEO→SEO→予約導線→口コミ に揃える
  const ordered = DOMAIN_ORDER.map(
    (domain) => domainScores.find((d) => d.domain === domain)!
  );

  const maxPoints = getTotalMaxPoints();
  const assessedMaxPoints = ordered.reduce((sum, d) => sum + d.assessedMaxPoints, 0);
  const totalPoints = ordered.reduce((sum, d) => sum + d.points, 0);
  const coverage = maxPoints === 0 ? 0 : assessedMaxPoints / maxPoints;
  const totalStatus = deriveAggregateStatus(
    ordered.map((d) => d.status),
    assessedMaxPoints
  );

  return {
    domains: ordered,
    maxPoints,
    assessedMaxPoints,
    totalPoints,
    coverage,
    totalStatus,
  };
}

/**
 * criterion/domainいずれの階層でも使う共通の集計ステータス判定。
 * criterion単位の入力はCriterionStatus(measured/estimated/unavailable)、
 * domain単位の入力はDomainAggregateStatus(measured/estimated/partial/unavailable)であり、
 * どちらの配列を渡してもよいように型を合わせている。
 *
 * 優先順位: 全項目unavailable(assessedMaxPoints=0) → "unavailable"
 *          一部でもunavailable/partialが混ざる → "partial"(「データ不足なのに高得点」に見えないよう明示。
 *            domain単位の"partial"はcriterion単位の"unavailable"と同じ「一部データ欠落」を表すため同列で扱う)
 *          全項目assessedだがestimatedが1件でもある → "estimated"
 *          全項目measured → "measured"
 */
function deriveAggregateStatus(
  itemStatuses: Array<CriterionStatus | DomainAggregateStatus>,
  assessedMaxPoints: number
): DomainAggregateStatus {
  if (assessedMaxPoints === 0) return "unavailable";
  if (itemStatuses.some((s) => s === "unavailable" || s === "partial")) return "partial";
  if (itemStatuses.some((s) => s === "estimated")) return "estimated";
  return "measured";
}

/**
 * 領域の達成率(0〜1)。assessed分のpoints/maxPointsで計算する(正本の満点に対する割合)。
 * unavailable(assessedMaxPoints===0)はnullを返す(改善優先度づけ側で「測定不能」として扱うため)。
 */
export function domainAchievementRate(score: DomainScore): number | null {
  if (score.status === "unavailable") return null;
  return score.points / score.maxPoints;
}
