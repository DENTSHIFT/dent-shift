import { DOMAIN_CRITERIA } from "@/domain/diagnosis/scoreCriteria";
import type { CriterionScore, DomainKey, UnavailableReason } from "@/domain/diagnosis/types";
import type { ScoreCriterionInput, ScoreProvider } from "./types";

/**
 * 2026-09-24のユーザー指示: 疑似乱数(seededRandom)で生成した具体的な点数を、
 * 実測結果のように本番ユーザーへ見せない。MockScoreProviderの乱数生成ロジックは
 * 本番経路から完全に排除し、実測根拠のない領域はすべて"unavailable"として扱う。
 *
 * 唯一の例外はAIOの一部criterion(ai_search_presence/recommendation_rank/
 * question_domain_coverage)で、これらは実際のAI観測結果(aiObservations、
 * ChatGPT/Gemini等への実測質問投げかけの結果)に基づいて機械的に算出されており、
 * 疑似乱数ではない根拠のある値のため、引き続き算出する(citation_acquisition/
 * information_accuracyは実測観測だけでは判定できず疑似乱数に依存していたため、
 * こちらはunavailableへ変更する)。
 *
 * MEO/SEO/LLMO/WEB_BOOKING/REVIEWSは実データ取得基盤(GBP/Search Console/GA4/
 * ページ本文解析等)が未実装のため、常にunavailableを返す。将来、実データ連携
 * providerへ差し替える際は、この同じScoreProviderインターフェースの別実装を追加すれば
 * domain層(scoring.ts)・サービス層は変更不要(MockScoreProviderと同じ設計方針)。
 */
export class UnavailableScoreProvider implements ScoreProvider {
  readonly name = "unavailable-score-provider";

  async score(domain: DomainKey, input: ScoreCriterionInput): Promise<CriterionScore[]> {
    if (domain === "AIO") {
      return this.scoreAioGroundedOnly(input);
    }
    return this.unavailableAll(domain, `${domain}の実測連携は現在準備中です`, "not_connected");
  }

  private unavailableAll(
    domain: DomainKey,
    reason: string,
    unavailableReason: UnavailableReason
  ): CriterionScore[] {
    return DOMAIN_CRITERIA[domain].map((def) => ({
      key: def.key,
      label: def.label,
      maxScore: def.maxScore,
      score: null,
      status: "unavailable",
      evidence: [{ summary: reason, ruleKey: def.ruleKey }],
      measuredAt: null,
      dataSource: "mock",
      unavailableReason,
    }));
  }

  /**
   * AIOのうち、実際のAI観測結果(aiObservations)だけから機械的に算出できる3criterion
   * (ai_search_presence/recommendation_rank/question_domain_coverage)のみ値を返す。
   * citation_acquisition/information_accuracyは実測手段が未接続のためunavailableにする
   * (旧MockScoreProviderではこの2つを疑似乱数で埋めていたが、本番では表示しない)。
   */
  private scoreAioGroundedOnly(input: ScoreCriterionInput): CriterionScore[] {
    const now = new Date().toISOString();
    const observations = input.aiObservations;
    const mentioned = observations.filter((o) => o.mentioned);
    const mentionRate = observations.length === 0 ? 0 : mentioned.length / observations.length;
    const distinctQuestionsMentioned = new Set(mentioned.map((o) => o.question)).size;
    const distinctQuestionsTotal = new Set(observations.map((o) => o.question)).size;
    const bestRank =
      mentioned.length === 0 ? null : Math.min(...mentioned.map((o) => o.recommendationRank ?? 99));

    const grounded: Record<string, { score: number; observedValue: string }> = {
      ai_search_presence: {
        score: Math.round(mentionRate * 10),
        observedValue: `${mentioned.length}/${observations.length}件のAI観測で言及`,
      },
      recommendation_rank: {
        score: bestRank === null ? 0 : Math.max(0, Math.round(5 - (bestRank - 1) * 1.5)),
        observedValue: bestRank === null ? "AI回答内で言及なし" : `最上位候補で ${bestRank} 番目に近い位置`,
      },
      question_domain_coverage: {
        score:
          distinctQuestionsTotal === 0
            ? 0
            : Math.round((distinctQuestionsMentioned / distinctQuestionsTotal) * 4),
        observedValue: `${distinctQuestionsMentioned}/${distinctQuestionsTotal} 質問領域で言及`,
      },
    };

    return DOMAIN_CRITERIA.AIO.map((def) => {
      const g = grounded[def.key];
      if (!g) {
        // citation_acquisition / information_accuracy: 実測手段が未接続のためunavailable。
        return {
          key: def.key,
          label: def.label,
          maxScore: def.maxScore,
          score: null,
          status: "unavailable" as const,
          evidence: [
            { summary: `${def.label}の実測連携は現在準備中です`, ruleKey: def.ruleKey },
          ],
          measuredAt: null,
          dataSource: "ai_provider" as const,
          unavailableReason: "not_connected" as const,
        };
      }
      const value = Math.max(0, Math.min(def.maxScore, g.score));
      return {
        key: def.key,
        label: def.label,
        maxScore: def.maxScore,
        score: value,
        status: "estimated" as const,
        evidence: [
          {
            summary: `${def.label}: ${g.observedValue}(実測AI観測に基づく参考値)`,
            ruleKey: def.ruleKey,
            observedValue: g.observedValue,
          },
        ],
        measuredAt: now,
        dataSource: "ai_provider" as const,
        unavailableReason: null,
      };
    });
  }
}
