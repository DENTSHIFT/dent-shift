import { describe, expect, it } from "vitest";
import { runFreeDiagnosis } from "@/server/services/runFreeDiagnosis";
import type { RunFreeDiagnosisDeps } from "@/server/services/runFreeDiagnosis";
import { UnavailableAiProvider } from "@/server/providers/ai/unavailableAiProvider";
import { UnavailableCompetitorProvider } from "@/server/providers/competitor/unavailableCompetitorProvider";
import { UnavailableScoreProvider } from "@/server/providers/scoring/unavailableScoreProvider";
import { UnavailableAdComplianceProvider } from "@/server/providers/ad-compliance/unavailableAdComplianceProvider";
import { DOMAIN_CRITERIA } from "@/domain/diagnosis/scoreCriteria";
import type { CriterionScore, DomainKey } from "@/domain/diagnosis/types";
import type { ScoreCriterionInput, ScoreProvider } from "@/server/providers/scoring/types";

/**
 * 2026-09-27(PO承認、P0最優先): 通常の無料診断(本番/testのcomposition rootと同じ
 * provider構成: UnavailableAiProvider + UnavailableScoreProvider、aiMeasurementProvider
 * 未設定)に、MockAiProvider由来の疑似データが一切混入しないことを保証する回帰テスト。
 *
 * tests/unit/runFreeDiagnosisCanonicalScoringIsolation.test.ts(2026-09-08承認の
 * 「canonical実測はscoreBreakdown/isSampleへ一切影響しない」分離)とは別の観点であり、
 * こちらは「legacy mockが一切影響しない」ことを保証する。
 *
 * 2026-09-29修正(PO指示): LLMOはWebsiteAnalysisScoreProvider(実サイト取得)へ委譲される
 * ようになった。このテストの観点(mock混入が無いこと)とLLMO実測機能は無関係のため、
 * 実ネットワーク呼び出しを避けるfakeのLLMO providerを注入し、「全領域unavailable」という
 * このテスト本来の前提を維持する(LLMO実測自体の挙動はwebsiteAnalysisScoreProvider.test.ts
 * で個別に検証する)。
 */
class AlwaysUnavailableFakeWebsiteProvider implements ScoreProvider {
  readonly name = "fake-always-unavailable-website-provider";
  async score(domain: DomainKey, input: ScoreCriterionInput): Promise<CriterionScore[]> {
    void input;
    return DOMAIN_CRITERIA[domain].map((def) => ({
      key: def.key,
      label: def.label,
      maxScore: def.maxScore,
      score: null,
      status: "unavailable",
      evidence: [{ summary: "fake: 実ネットワークを使わないテスト用スタブ", ruleKey: def.ruleKey }],
      measuredAt: null,
      dataSource: "website",
      unavailableReason: "not_connected",
    }));
  }
}

const PROD_LIKE_INPUT = {
  clinicName: "Mock除去検証歯科医院",
  directorName: "テスト院長",
  clinicUrl: "https://example.com",
  contactEmail: "test@example.com",
  contactPhone: "03-1234-5678",
};

function prodLikeDeps(): RunFreeDiagnosisDeps {
  return {
    aiProvider: new UnavailableAiProvider(),
    competitorProvider: new UnavailableCompetitorProvider(),
    scoreProvider: new UnavailableScoreProvider(new AlwaysUnavailableFakeWebsiteProvider()),
    adComplianceProvider: new UnavailableAdComplianceProvider(),
    // aiMeasurementProvider未指定 = AI_MEASUREMENT_PROVIDER="mock"(canonical無効)時と同じ状態
  };
}

describe("通常診断からのMock除去(2026-09-27、PO承認)", () => {
  it("1. Mockデータが通常診断へ一切混入しない(isSample=falseになる)", async () => {
    const result = await runFreeDiagnosis(PROD_LIKE_INPUT, prodLikeDeps());
    expect(result.isSample).toBe(false);
    expect(result.aiObservations).toEqual([]);
  });

  it("2. 外部AI未設定時は全患者質問がinsufficient_data(データ不足)になり、勝敗を捏造しない", async () => {
    const result = await runFreeDiagnosis(PROD_LIKE_INPUT, prodLikeDeps());
    for (const q of result.questionResults) {
      expect(q.status).toBe("insufficient_data");
      expect(q.evidence).toEqual([]); // [mock]根拠文言が出ない
    }
  });

  it("3. 外部AI未設定時は6領域すべてunavailableになり、総合スコアはunavailable(算定不可)になる", async () => {
    const result = await runFreeDiagnosis(PROD_LIKE_INPUT, prodLikeDeps());
    for (const domain of result.scoreBreakdown.domains) {
      expect(domain.status).toBe("unavailable");
      for (const criterion of domain.criteria) {
        expect(criterion.status).toBe("unavailable");
        expect(criterion.score).toBeNull(); // 未測定を0点にしない
        expect(criterion.dataSource).not.toBe("mock"); // mockタグの誤付与を防ぐ回帰
      }
    }
    expect(result.scoreBreakdown.totalStatus).toBe("unavailable");
    expect(result.scoreBreakdown.assessedMaxPoints).toBe(0);
  });

  it("4. 未測定を0点として合算しない(assessedMaxPointsが分母から正しく除外される)", async () => {
    const result = await runFreeDiagnosis(PROD_LIKE_INPUT, prodLikeDeps());
    // maxPoints(満点の分母)は不変のまま、assessedMaxPoints(測定できた分母)だけが0になる
    expect(result.scoreBreakdown.maxPoints).toBeGreaterThan(0);
    expect(result.scoreBreakdown.assessedMaxPoints).toBe(0);
    expect(result.scoreBreakdown.totalPoints).toBe(0);
  });

  it("5. 改善TOP3・root causeが、根拠のないMock由来の内容を生成しない", async () => {
    const result = await runFreeDiagnosis(PROD_LIKE_INPUT, prodLikeDeps());
    // 患者質問が全てinsufficient_dataのため、質問起点の改善候補(勝敗ベース)は生成されない
    expect(result.aioLossRootCauses).toEqual([]);
    // TOP3に残る候補は、既存のdata_gap種別(「計測準備中」の正直な案内)のみで、
    // Mockの勝敗判定に基づく断定的な弱点指摘(kind !== "data_gap")は含まれない。
    for (const task of result.topImprovements) {
      expect(task.kind).toBe("data_gap");
    }
  });
});
