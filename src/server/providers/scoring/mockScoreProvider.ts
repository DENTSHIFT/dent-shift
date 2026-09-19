import { seededRandom } from "@/lib/prng";
import { DOMAIN_CRITERIA } from "@/domain/diagnosis/scoreCriteria";
import type { CriterionScore, DomainKey, UnavailableReason } from "@/domain/diagnosis/types";
import type { ScoreCriterionInput, ScoreProvider } from "./types";

// 「開発用mock/実測ではない」ことをevidenceに必ず含める(正本の絶対ルール3章-12準拠)
const MOCK_DISCLAIMER = "開発用mock・実測ではありません";

/**
 * P0用のモックscore provider。
 *
 * 決定論的な擬似乱数(seededRandom)は、この provider 層に完全に閉じ込める。
 * domain層(scoring.ts)には一切の乱数・非決定的処理を持ち込まない。
 *
 * 返す全criterionは必ず dataSource: "mock" とし、status は
 * - 必要な入力(GBP URL/予約URL等)が無い → "unavailable"(0点扱いしない)
 * - それ以外 → "estimated"(mockである以上、"measured"は名乗らない)
 * のいずれかに限定する。「measured」は将来の実データ連携provider専用。
 */
export class MockScoreProvider implements ScoreProvider {
  readonly name = "mock-score-provider";

  async score(domain: DomainKey, input: ScoreCriterionInput): Promise<CriterionScore[]> {
    if (domain === "MEO" && !input.gbpUrl) {
      // GBP URL自体が入力されていない = 必要な入力値が提供されていない("not_provided")
      return this.unavailableAll(domain, "GBP(Googleビジネスプロフィール)のURLが未入力のため測定できません", "not_provided");
    }
    if (domain === "WEB_BOOKING" && !input.bookingUrl) {
      // 予約導線URL自体が入力されていない = 必要な入力値が提供されていない("not_provided")
      return this.unavailableAll(domain, "Web予約導線のURLが未入力のため測定できません", "not_provided");
    }
    if (domain === "AIO") {
      return this.scoreAio(input);
    }
    return this.scoreGeneric(domain, input.clinicName);
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

  /** AIO/MEO/WEB_BOOKING以外(LLMO/SEO/REVIEWS)、およびGBP/予約URLがあるMEO/WEB_BOOKING向けの汎用mock生成 */
  private scoreGeneric(domain: DomainKey, clinicName: string): CriterionScore[] {
    const now = new Date().toISOString();
    return DOMAIN_CRITERIA[domain].map((def) => {
      const rand = seededRandom(`score:${clinicName}:${domain}:${def.key}`);
      const value = Math.max(0, Math.min(def.maxScore, Math.round(rand() * def.maxScore)));
      return {
        key: def.key,
        label: def.label,
        maxScore: def.maxScore,
        score: value,
        status: "estimated",
        evidence: [
          {
            summary: `[${MOCK_DISCLAIMER}] ${def.label}: 開発用に生成した仮点数(${value}/${def.maxScore})`,
            ruleKey: def.ruleKey,
            observedValue: value,
          },
        ],
        measuredAt: now,
        dataSource: "mock",
        unavailableReason: null,
      };
    });
  }

  /**
   * AIOはmockAiProvider(ChatGPT/Gemini風の擬似観測結果)を根拠として使う。
   * 本番でAI providerが実接続に差し替わっても、この関数の入出力形は変えずに済む設計。
   *
   * 【2026-09-08のユーザー指示: AIO scoring接続ラウンド(案B)】
   * P0では本関数を意図的にcanonical AI計測観測(AiMeasurementObservation)を消費しない
   * ままにする。理由は、AIOの5criterionのうちcitation_acquisition/information_accuracy
   * が恒久的に実シグナルを持たずrand()に依存し、recommendation_rank/question_domain_coverage
   * も6問横断のblended計算であるため、質問単位のcanonical measured値をこの関数へ部分的に
   * 混ぜるとcanonical measured evidenceとlegacy reference evidenceが1つのcriterion内で
   * 混在してしまう(禁止事項)。そのため、既存AIO30点はP0では引き続きreference/mockベースの
   * まま維持し、canonicalの実測価値はquestionResults.status/statusSource/measurementCoverage/
   * canonical root cause側でのみ提供する(measurement overlay方針。tests/unit/
   * runFreeDiagnosisCanonicalScoringIsolation.test.tsでこの非接続を回帰確認している)。
   * 将来canonical measured scoreを正式導入する場合は、本関数を直接変更せず、別経路の
   * 集計を追加する設計にすること(このJSDocも参照)。
   */
  private scoreAio(input: ScoreCriterionInput): CriterionScore[] {
    const now = new Date().toISOString();
    const observations = input.aiObservations;
    const mentioned = observations.filter((o) => o.mentioned);
    const mentionRate = observations.length === 0 ? 0 : mentioned.length / observations.length;
    const distinctQuestionsMentioned = new Set(mentioned.map((o) => o.question)).size;
    const distinctQuestionsTotal = new Set(observations.map((o) => o.question)).size;
    const bestRank =
      mentioned.length === 0 ? null : Math.min(...mentioned.map((o) => o.recommendationRank ?? 99));

    // citation_acquisition / information_accuracy は現時点でAI観測結果だけでは判定できないため、
    // 開発用の仮点数で補う(将来、引用元URL照合・正解データ照合の実装に置き換える)
    const rand = seededRandom(`score:${input.clinicName}:AIO`);

    const raw: Record<string, { score: number; observedValue: string }> = {
      ai_search_presence: {
        score: Math.round(mentionRate * 10),
        observedValue: `${mentioned.length}/${observations.length}件のAI観測で言及`,
      },
      citation_acquisition: {
        score: Math.round(rand() * 6),
        observedValue: "開発用mock(引用元URLの実照合は未接続)",
      },
      recommendation_rank: {
        score: bestRank === null ? 0 : Math.max(0, Math.round(5 - (bestRank - 1) * 1.5)),
        observedValue: bestRank === null ? "AI回答内で言及なし" : `最上位候補で ${bestRank} 番目に近い位置`,
      },
      information_accuracy: {
        score: Math.round(rand() * 5),
        observedValue: "開発用mock(正解データとの照合は未接続)",
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
      const v = raw[def.key];
      if (!v) {
        // DOMAIN_CRITERIA.AIOとrawのキーは常に一致する前提(正本のcriterion定義に基づく)。
        // 一致しない場合はロジックの不整合なので、黙って0点にせず早期に検知する。
        throw new Error(`AIOスコアリング: 未定義のcriterion "${def.key}" が指定されました`);
      }
      const value = Math.max(0, Math.min(def.maxScore, v.score));
      return {
        key: def.key,
        label: def.label,
        maxScore: def.maxScore,
        score: value,
        status: "estimated",
        evidence: [
          {
            summary: `[${MOCK_DISCLAIMER}] ${def.label}: ${v.observedValue}`,
            ruleKey: def.ruleKey,
            observedValue: v.observedValue,
          },
        ],
        measuredAt: now,
        dataSource: "mock",
        unavailableReason: null,
      };
    });
  }
}
