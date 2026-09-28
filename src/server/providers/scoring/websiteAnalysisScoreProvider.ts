import "server-only";
import { DOMAIN_CRITERIA } from "@/domain/diagnosis/scoreCriteria";
import type { CriterionScore, DomainKey, UnavailableReason } from "@/domain/diagnosis/types";
import type { ScoreCriterionInput, ScoreProvider } from "./types";
import { safeFetch, type SafeFetchOverrides, type SafeFetchFailureReason } from "@/server/net/safeUrlFetcher";
import {
  analyzeRobotsTxt,
  analyzeNoindex,
  analyzeStructuredData,
  analyzeContentClarity,
} from "@/server/providers/website-analysis/websiteAnalyzer";

/**
 * 2026-09-29追加(PO指示、10/1 P0範囲): LLMOのうちcrawler_access/structured_data/
 * content_clarityの3項目だけを、医院サイトの実取得(safeFetch、SSRF対策済み)から
 * 機械的に実測する。info_consistency(住所情報が無いため)・content_provenance
 * (評価定義未確定のため)は、この実装後も引き続きunavailableのまま維持する
 * (PO指示: 「以下は未測定を維持します」)。
 *
 * UnavailableScoreProviderのLLMO分岐だけをこのproviderへ差し替える形で使う想定
 * (他5領域・AIOには一切影響しない)。
 */
export class WebsiteAnalysisScoreProvider implements ScoreProvider {
  readonly name = "website-analysis-score-provider";
  private readonly overrides: SafeFetchOverrides;

  constructor(overrides: SafeFetchOverrides = {}) {
    this.overrides = overrides;
  }

  async score(domain: DomainKey, input: ScoreCriterionInput): Promise<CriterionScore[]> {
    if (domain !== "LLMO") {
      // このproviderはLLMO専用。呼び出し側の配線ミスを早期に検知するため明示的にthrowする。
      throw new Error(`WebsiteAnalysisScoreProvider does not support domain "${domain}"`);
    }
    return this.scoreLlmo(input.clinicUrl);
  }

  private async scoreLlmo(clinicUrl: string): Promise<CriterionScore[]> {
    const now = new Date().toISOString();
    const definitions = DOMAIN_CRITERIA.LLMO;
    const byKey = new Map(definitions.map((d) => [d.key, d]));

    // info_consistency/content_provenanceは常にunavailable(PO指示、10/1範囲外)。
    const alwaysUnavailable = (key: string, reason: string, unavailableReason: UnavailableReason): CriterionScore => {
      const def = byKey.get(key)!;
      return {
        key: def.key,
        label: def.label,
        maxScore: def.maxScore,
        score: null,
        status: "unavailable",
        evidence: [{ summary: reason, ruleKey: def.ruleKey }],
        measuredAt: null,
        dataSource: "website",
        unavailableReason,
      };
    };

    const results: CriterionScore[] = [
      alwaysUnavailable(
        "info_consistency",
        "住所情報が未登録のため、医院情報の一貫性は測定できません",
        "not_provided"
      ),
      alwaysUnavailable(
        "content_provenance",
        "情報の根拠・更新性の評価基準は今後整理予定のため、現時点では測定していません",
        "not_applicable"
      ),
    ];

    const mainPage = await safeFetch(clinicUrl, this.overrides);
    results.push(await this.scoreCrawlerAccess(byKey.get("crawler_access")!, clinicUrl, mainPage, now));
    results.push(this.scoreStructuredData(byKey.get("structured_data")!, mainPage, now));
    results.push(this.scoreContentClarity(byKey.get("content_clarity")!, mainPage, now));

    // 定義順(scoreCriteria.tsのDOMAIN_CRITERIA.LLMO順)に整列して返す
    // (calculateDomainScoreはcriterion集合の一致のみを検証し順序は問わないが、
    // 表示の安定性のため揃えておく)。
    return definitions.map((def) => results.find((r) => r.key === def.key)!);
  }

  /**
   * crawler_access(配点3): 以下3点を統合して判定する。
   * 1. URL到達可否・HTTP状態(mainPage.ok自体が前提条件)
   * 2. robots.txtで主要AIクローラーがDisallowされていないか
   * 3. noindex(meta robotsタグ・X-Robots-Tagヘッダ)が付いていないか
   * robots.txt自体が存在しない(fetch失敗)場合は「制限が無い」ものとして扱う
   * (robots.txt不在はクロール制限が無いことを意味するのが仕様上の標準解釈のため、
   * この項目だけは取得失敗をunavailableにしない)。
   */
  private async scoreCrawlerAccess(
    def: { key: string; label: string; maxScore: number; ruleKey: string },
    clinicUrl: string,
    mainPage: Awaited<ReturnType<typeof safeFetch>>,
    now: string
  ): Promise<CriterionScore> {
    if (!mainPage.ok) {
      return this.unavailableFromFetchFailure(def, mainPage.reason, now, "サイトURLへ到達できませんでした");
    }

    let origin: string;
    try {
      origin = new URL(clinicUrl).origin;
    } catch {
      return this.unavailableFromFetchFailure(def, "invalid_url", now, "サイトURLの形式が不正です");
    }

    const robotsResult = await safeFetch(`${origin}/robots.txt`, this.overrides);
    const robotsAnalysis = robotsResult.ok
      ? analyzeRobotsTxt(robotsResult.body)
      : { fetched: false, allowsAiCrawlers: true, blockedUserAgents: [] as string[] };

    const noindexAnalysis = analyzeNoindex(mainPage.body, mainPage.xRobotsTag);
    const hasNoindex = noindexAnalysis.hasNoindexMeta || noindexAnalysis.hasNoindexHeader;

    let score: number;
    let observedValue: string;
    if (hasNoindex) {
      score = 0;
      observedValue = "noindexが設定されているため、検索・AIクローラーからのアクセスが制限されています";
    } else if (!robotsAnalysis.allowsAiCrawlers) {
      score = Math.round(def.maxScore / 3);
      observedValue = `robots.txtで一部クローラーを拒否しています(${robotsAnalysis.blockedUserAgents.join(", ")})`;
    } else {
      score = def.maxScore;
      observedValue = robotsAnalysis.fetched
        ? "robots.txtで主要AIクローラーは許可されており、noindexも設定されていません"
        : "robots.txtは未設置(制限なしとして扱います)。noindexも設定されていません";
    }

    return {
      key: def.key,
      label: def.label,
      maxScore: def.maxScore,
      score,
      status: "measured",
      evidence: [{ summary: observedValue, ruleKey: def.ruleKey, observedValue }],
      measuredAt: now,
      dataSource: "website",
      unavailableReason: null,
    };
  }

  private unavailableFromFetchFailure(
    def: { key: string; label: string; maxScore: number; ruleKey: string },
    reason: SafeFetchFailureReason | "invalid_url",
    now: string,
    summaryPrefix: string
  ): CriterionScore {
    return {
      key: def.key,
      label: def.label,
      maxScore: def.maxScore,
      score: null,
      status: "unavailable",
      evidence: [{ summary: `${summaryPrefix}(${reason})`, ruleKey: def.ruleKey }],
      measuredAt: null,
      dataSource: "website",
      unavailableReason: "fetch_failed",
    };
  }

  private scoreStructuredData(
    def: { key: string; label: string; maxScore: number; ruleKey: string },
    mainPage: Awaited<ReturnType<typeof safeFetch>>,
    now: string
  ): CriterionScore {
    if (!mainPage.ok) {
      return this.unavailableFromFetchFailure(def, mainPage.reason, now, "サイトを取得できなかったため測定できません");
    }
    const analysis = analyzeStructuredData(mainPage.body);
    const score = !analysis.found ? 0 : analysis.hasMedicalRelevantType ? def.maxScore : Math.round(def.maxScore / 2);
    const observedValue = !analysis.found
      ? "構造化データ(JSON-LD)が見つかりませんでした"
      : `構造化データを検出: ${analysis.types.join(", ")}${analysis.hasMedicalRelevantType ? "(医療機関向けの型を含む)" : "(医療機関向けの型は未検出)"}`;
    return {
      key: def.key,
      label: def.label,
      maxScore: def.maxScore,
      score,
      status: "measured",
      evidence: [{ summary: observedValue, ruleKey: def.ruleKey, observedValue }],
      measuredAt: now,
      dataSource: "website",
      unavailableReason: null,
    };
  }

  private scoreContentClarity(
    def: { key: string; label: string; maxScore: number; ruleKey: string },
    mainPage: Awaited<ReturnType<typeof safeFetch>>,
    now: string
  ): CriterionScore {
    if (!mainPage.ok) {
      return this.unavailableFromFetchFailure(def, mainPage.reason, now, "サイトを取得できなかったため測定できません");
    }
    const analysis = analyzeContentClarity(mainPage.body);
    const score = analysis.hasReadableContent ? def.maxScore : analysis.hasH1 ? Math.round(def.maxScore / 2) : 0;
    const observedValue = `見出し${analysis.headingCount}個、本文相当${analysis.textLength}文字を検出`;
    return {
      key: def.key,
      label: def.label,
      maxScore: def.maxScore,
      score,
      status: "measured",
      evidence: [{ summary: observedValue, ruleKey: def.ruleKey, observedValue }],
      measuredAt: now,
      dataSource: "website",
      unavailableReason: null,
    };
  }
}
