import { describe, expect, it } from "vitest";
import {
  UNAVAILABLE_REASON_LABEL_JA,
  DOMAIN_DISPLAY_ORDER,
  buildAdComplianceViewModel,
  buildCompetitorViewModels,
  buildDomainViewModel,
  buildDomainViewModels,
  buildFreeDiagnosisResultViewModel,
  buildImprovementViewModel,
  buildLossRootCauseViewModels,
  buildMeasurementViewModel,
  normalizeLegacyDataDisclaimer,
  buildOverallScoreViewModel,
  buildQuestionResultViewModel,
  buildSampleBanner,
  type DiagnosisResultData,
} from "@/app/diagnosis/result/[id]/resultViewModel";
import type { DomainScore, UnavailableReason } from "@/domain/diagnosis/types";
import type { CompetitorClinic, PatientQuestionResult } from "@/domain/competitor/types";
import type { AdComplianceCheckResult, AdRiskFinding } from "@/domain/ad-compliance/types";
import type { ImprovementCandidate } from "@/domain/improvement-task/types";

/**
 * 無料診断結果画面のview-model構築ロジックのunit test(2026-09-05のユーザー指示
 * 「DENT SHIFT 無料診断結果画面の正式UI実装」)。
 * このリポジトリにjsdom/testing-libraryが無いため、Reactコンポーネント自体は
 * テストせず、表示直前のデータ整形・表示判断ロジック(このファイルが検証対象)を
 * 純粋関数としてテストすることでUI表示ルールの検証とする。
 */

function domainScore(overrides: Partial<DomainScore> = {}): DomainScore {
  return {
    domain: "AIO",
    maxPoints: 30,
    assessedMaxPoints: 30,
    points: 20,
    coverage: 1,
    status: "measured",
    criteria: [],
    ...overrides,
  };
}

function questionResult(overrides: Partial<PatientQuestionResult> = {}): PatientQuestionResult {
  return {
    question: "質問A",
    status: "lose",
    evidence: [],
    unavailableReason: null,
    competitorDifference: [],
    rootCauseKey: null,
    rootCauseLabel: null,
    confidence: null,
    sourceType: null,
    provisional: false,
    attributionStatus: "not_applicable",
    analysisVersion: null,
    ...overrides,
  };
}

describe("UNAVAILABLE_REASON_LABEL_JA(unavailableReasonのUI変換)", () => {
  it("ユーザー指定の7種類すべてを、指定どおりの日本語文言に変換する", () => {
    const expected: Record<UnavailableReason, string> = {
      not_provided: "必要な情報が入力されていません",
      not_connected: "まだ連携されていません",
      permission_required: "再認証または権限の確認が必要です",
      insufficient_data: "評価に必要なデータが不足しています",
      temporarily_unavailable: "現在データを取得できません",
      fetch_failed: "データ取得に失敗しました",
      not_applicable: "今回の診断では対象外です",
    };
    expect(UNAVAILABLE_REASON_LABEL_JA).toEqual(expected);
  });
});

describe("buildSampleBanner(sample/mockのUI明示)", () => {
  it("isSample=falseのときは表示しない", () => {
    const banner = buildSampleBanner(false);
    expect(banner.show).toBe(false);
  });

  it("isSample=trueのときは「サンプル診断」であることを明確に表示する", () => {
    const banner = buildSampleBanner(true);
    expect(banner.show).toBe(true);
    expect(banner.title).toContain("サンプル診断");
  });
});

describe("buildOverallScoreViewModel", () => {
  it("partialのとき、0点として扱っていない旨のcaveatを出す", () => {
    const vm = buildOverallScoreViewModel(40, "partial", 100);
    expect(vm.statusCaveat).toContain("0点として扱っていません");
  });

  it("measuredのときはcaveatを出さない", () => {
    const vm = buildOverallScoreViewModel(80, "measured", 100);
    expect(vm.statusCaveat).toBeNull();
  });
});

describe("buildDomainViewModel(6領域スコア・最重要ルール: 0として表示しない)", () => {
  it("measuredな領域は点数と満点、進捗パーセントを表示する", () => {
    const vm = buildDomainViewModel(domainScore({ status: "measured", points: 21, maxPoints: 30 }));
    expect(vm.pointsLabel).toBe("21 / 30点");
    expect(vm.percent).toBeCloseTo(70);
    expect(vm.showEstimatedBadge).toBe(false);
    expect(vm.unavailableReasonLabel).toBeNull();
  });

  it("estimatedな領域は推定バッジを立てる", () => {
    const vm = buildDomainViewModel(domainScore({ status: "estimated", points: 15, maxPoints: 30 }));
    expect(vm.showEstimatedBadge).toBe(true);
  });

  it("unavailableな領域は「0」を一切表示せず、取得不能である旨とunavailableReasonの日本語訳を表示する", () => {
    const vm = buildDomainViewModel(
      domainScore({
        status: "unavailable",
        points: 0,
        criteria: [
          {
            key: "k1",
            label: "l1",
            maxScore: 10,
            score: null,
            status: "unavailable",
            evidence: [],
            measuredAt: null,
            dataSource: "manual",
            unavailableReason: "not_connected",
          },
        ],
      })
    );
    expect(vm.pointsLabel).toBe("取得不能");
    expect(vm.pointsLabel).not.toContain("0");
    expect(vm.percent).toBeNull();
    expect(vm.unavailableReasonLabel).toBe("まだ連携されていません");
  });

  it("unavailableな領域で理由が複数種類混在する場合は、単一理由を断定せず汎用メッセージにする", () => {
    const vm = buildDomainViewModel(
      domainScore({
        status: "unavailable",
        criteria: [
          {
            key: "k1",
            label: "l1",
            maxScore: 10,
            score: null,
            status: "unavailable",
            evidence: [],
            measuredAt: null,
            dataSource: "manual",
            unavailableReason: "not_connected",
          },
          {
            key: "k2",
            label: "l2",
            maxScore: 10,
            score: null,
            status: "unavailable",
            evidence: [],
            measuredAt: null,
            dataSource: "manual",
            unavailableReason: "permission_required",
          },
        ],
      })
    );
    expect(vm.unavailableReasonLabel).toBe("複数の要因により評価できません");
  });

  it("partialな領域は、未測定項目の件数と理由を注記する(取得できた分のみで集計)", () => {
    const vm = buildDomainViewModel(
      domainScore({
        status: "partial",
        points: 10,
        maxPoints: 30,
        criteria: [
          {
            key: "k1",
            label: "l1",
            maxScore: 10,
            score: null,
            status: "unavailable",
            evidence: [],
            measuredAt: null,
            dataSource: "manual",
            unavailableReason: "insufficient_data",
          },
        ],
      })
    );
    expect(vm.partialNote).toContain("1件");
    expect(vm.partialNote).toContain("評価に必要なデータが不足しています");
  });
});

describe("buildDomainViewModels(6領域の表示順)", () => {
  it("ユーザー指示どおりAIO/MEO/SEO/LLMO/Web予約/口コミ・信頼の順で並び替える", () => {
    const domains: DomainScore[] = [
      domainScore({ domain: "REVIEWS" }),
      domainScore({ domain: "WEB_BOOKING" }),
      domainScore({ domain: "SEO" }),
      domainScore({ domain: "LLMO" }),
      domainScore({ domain: "AIO" }),
      domainScore({ domain: "MEO" }),
    ];
    const vms = buildDomainViewModels(domains);
    expect(vms.map((v) => v.domain)).toEqual(DOMAIN_DISPLAY_ORDER);
  });
});

describe("buildQuestionResultViewModel(患者質問別のAI表示状況)", () => {
  it("内部statusを院長向けの中立な表示ラベルへ変換する", () => {
    expect(buildQuestionResultViewModel(questionResult({ status: "win" })).statusLabel).toBe(
      "表示良好"
    );
    expect(buildQuestionResultViewModel(questionResult({ status: "close" })).statusLabel).toBe(
      "競合と同程度"
    );
    expect(buildQuestionResultViewModel(questionResult({ status: "lose" })).statusLabel).toBe(
      "改善余地あり"
    );
    expect(
      buildQuestionResultViewModel(questionResult({ status: "insufficient_data" })).statusLabel
    ).toBe("データ不足");
  });

  it("win/close/loseのときはcaptionLabelを出さない", () => {
    expect(buildQuestionResultViewModel(questionResult({ status: "win" })).captionLabel).toBeNull();
    expect(buildQuestionResultViewModel(questionResult({ status: "close" })).captionLabel).toBeNull();
    expect(buildQuestionResultViewModel(questionResult({ status: "lose" })).captionLabel).toBeNull();
  });

  it("insufficient_dataのときはunavailableReasonを日本語表示する", () => {
    const vm = buildQuestionResultViewModel(
      questionResult({ status: "insufficient_data", unavailableReason: "insufficient_data" })
    );
    expect(vm.captionLabel).toBe("評価に必要なデータが不足しています");
  });

  it("legacy_referenceと既存診断のstatusSource欠損は実測と表示せず参考データにする", () => {
    expect(
      buildQuestionResultViewModel(questionResult({ statusSource: "legacy_reference" }))
    ).toMatchObject({ dataSourceLabel: "参考データ", dataSourceTone: "warn" });
    expect(buildQuestionResultViewModel(questionResult())).toMatchObject({
      dataSourceLabel: "参考データ",
      dataSourceTone: "warn",
    });
  });

  it("canonical対象providerが全件measuredなら実測データにする", () => {
    const vm = buildQuestionResultViewModel(
      questionResult({
        statusSource: "canonical_measurement",
        measurementCoverage: {
          totalProviders: 2,
          measuredProviders: 2,
          referenceProviders: 0,
          unavailableProviders: 0,
          isPartial: false,
        },
      })
    );
    expect(vm).toMatchObject({ dataSourceLabel: "実測データ", dataSourceTone: "info" });
  });

  it("canonicalでmeasuredと未測定が混在する場合は一部実測にする", () => {
    const vm = buildQuestionResultViewModel(
      questionResult({
        statusSource: "canonical_measurement",
        measurementCoverage: {
          totalProviders: 2,
          measuredProviders: 1,
          referenceProviders: 0,
          unavailableProviders: 1,
          isPartial: true,
        },
      })
    );
    expect(vm).toMatchObject({ dataSourceLabel: "一部実測", dataSourceTone: "warn" });
  });

  it("canonicalで実測0件ならreference/unavailableの内訳を推測せず表示する", () => {
    const reference = buildQuestionResultViewModel(
      questionResult({
        statusSource: "canonical_measurement",
        measurementCoverage: {
          totalProviders: 1,
          measuredProviders: 0,
          referenceProviders: 1,
          unavailableProviders: 0,
          isPartial: true,
        },
      })
    );
    const unavailable = buildQuestionResultViewModel(
      questionResult({
        statusSource: "canonical_measurement",
        measurementCoverage: {
          totalProviders: 1,
          measuredProviders: 0,
          referenceProviders: 0,
          unavailableProviders: 1,
          isPartial: true,
        },
      })
    );
    const mixed = buildQuestionResultViewModel(
      questionResult({
        statusSource: "canonical_measurement",
        measurementCoverage: {
          totalProviders: 2,
          measuredProviders: 0,
          referenceProviders: 1,
          unavailableProviders: 1,
          isPartial: true,
        },
      })
    );
    expect(reference.dataSourceLabel).toBe("参考データ");
    expect(unavailable.dataSourceLabel).toBe("取得不能");
    expect(mixed.dataSourceLabel).toBe("参考・取得不能");
  });

  it("canonicalなのにcoverageが欠損している既存データは取得状況不明にする", () => {
    expect(
      buildQuestionResultViewModel(
        questionResult({ statusSource: "canonical_measurement", measurementCoverage: null })
      )
    ).toMatchObject({ dataSourceLabel: "取得状況不明", dataSourceTone: "muted" });
  });
});

describe("buildLossRootCauseViewModels(「なぜ負けている？」の表示構造)", () => {
  it("患者質問→競合との差→なぜ負けているか→根拠が追える構造で構築する", () => {
    const results: PatientQuestionResult[] = [
      questionResult({
        question: "質問A",
        status: "lose",
        competitorDifference: ["競合A"],
        rootCauseKey: "AIO:ai_search_presence",
        rootCauseLabel: "AIの回答に自院が表示されていない",
        confidence: "medium",
        sourceType: "canonical_measurement",
        provisional: false,
        attributionStatus: "attributed",
        analysisVersion: "v1",
        evidence: ["[chatgpt] 自院は言及されていない"],
      }),
      questionResult({
        question: "質問B",
        status: "win",
      }),
    ];
    const vms = buildLossRootCauseViewModels(results);
    expect(vms).toHaveLength(1);
    expect(vms[0]!.rootCauseLabel).toBe("AIの回答に自院が表示されていない");
    expect(vms[0]!.questions).toHaveLength(1);
    expect(vms[0]!.questions[0]!.question).toBe("質問A");
    expect(vms[0]!.questions[0]!.competitorDifference).toEqual(["競合A"]);
    expect(vms[0]!.questions[0]!.evidence).toEqual([
      { text: "自院は言及されていない", providerLabel: "ChatGPT", isSample: false },
    ]);
  });

  it("insufficient_evidenceの質問(原因を断定できない)は集約対象に含まれない", () => {
    const results: PatientQuestionResult[] = [
      questionResult({ question: "質問C", status: "lose", attributionStatus: "insufficient_evidence" }),
    ];
    expect(buildLossRootCauseViewModels(results)).toHaveLength(0);
  });

  it("mock由来で汚染されたprovisional判定はisProvisionalとして明示される", () => {
    const results: PatientQuestionResult[] = [
      questionResult({
        question: "質問D",
        status: "lose",
        rootCauseKey: "AIO:ai_search_presence",
        rootCauseLabel: "label",
        confidence: "medium",
        sourceType: "mock",
        provisional: true,
        attributionStatus: "attributed",
        analysisVersion: "v1",
      }),
    ];
    const vms = buildLossRootCauseViewModels(results);
    expect(vms[0]!.isProvisional).toBe(true);
  });
});

describe("buildCompetitorViewModels(競合比較。捏造禁止)", () => {
  it("競合にスコアを付与しない(名称・URL・距離のみ)", () => {
    const competitors: CompetitorClinic[] = [
      { id: "c1", name: "競合歯科クリニック", url: "https://example.com", distanceKm: 1.234 },
      { id: "c2", name: "距離不明クリニック" },
    ];
    const vms = buildCompetitorViewModels(competitors);
    expect(vms[0]).toEqual({
      name: "競合歯科クリニック",
      url: "https://example.com",
      distanceLabel: "1.2km圏内",
    });
    expect(vms[1]!.distanceLabel).toBeNull();
    // scoreフィールド自体が型に存在しないため、キーとして出現しないことも確認する
    expect(vms[0]).not.toHaveProperty("score");
  });
});

function adFinding(overrides: Partial<AdRiskFinding> = {}): AdRiskFinding {
  return {
    id: "f1",
    category: "efficacy_assertion",
    severity: "high",
    confidence: "high",
    matchStrength: "direct",
    confidenceBasis: "既知パターンに直接一致",
    evidence: [
      {
        category: "efficacy_assertion",
        quotedText: "絶対に治ります",
        sourceLocation: "トップページ",
        detectionReason: "効果を断定する表現",
        sourceType: "rule_based",
      },
    ],
    mergedOccurrenceCount: 1,
    displayMessage:
      "これはAIによるリスクチェックであり、法令違反を断定するものではありません。最終判断は医院または専門家が行ってください。",
    requiresReviewBy: "院長・法務担当",
    escalationEligible: false,
    sourceType: "rule_based",
    provisional: false,
    sourceLabel: "実際の入力テキストから検出",
    ...overrides,
  };
}

describe("buildAdComplianceViewModel(医療広告AIチェック)", () => {
  it("mock由来(provisional)の所見は、severityが高くても警戒色(risk)にしない", () => {
    const result: AdComplianceCheckResult = {
      findings: [adFinding({ severity: "high", provisional: true, sourceType: "mock" })],
      disclaimer: "これはAIによるリスクチェックであり、法令違反を断定するものではありません。最終判断は医院または専門家が行ってください。",
      checkedAt: "2026-09-06T00:00:00.000Z",
    };
    const vm = buildAdComplianceViewModel(result);
    expect(vm.findings[0]!.visualTone).toBe("sample");
  });

  it("実測(非mock)の所見はrisk表示にする", () => {
    const result: AdComplianceCheckResult = {
      findings: [adFinding({ provisional: false, sourceType: "rule_based" })],
      disclaimer: "d",
      checkedAt: "2026-09-06T00:00:00.000Z",
    };
    const vm = buildAdComplianceViewModel(result);
    expect(vm.findings[0]!.visualTone).toBe("risk");
  });

  it("evidence単位でsourceType=mockのものだけをサンプル扱いする", () => {
    const result: AdComplianceCheckResult = {
      findings: [
        adFinding({
          provisional: false,
          evidence: [
            {
              category: "efficacy_assertion",
              quotedText: "実データ由来",
              sourceLocation: "a",
              detectionReason: "b",
              sourceType: "rule_based",
            },
            {
              category: "efficacy_assertion",
              quotedText: "mock由来",
              sourceLocation: "c",
              detectionReason: "d",
              sourceType: "mock",
            },
          ],
        }),
      ],
      disclaimer: "d",
      checkedAt: "2026-09-06T00:00:00.000Z",
    };
    const vm = buildAdComplianceViewModel(result);
    expect(vm.findings[0]!.evidence[0]!.isSampleEvidence).toBe(false);
    expect(vm.findings[0]!.evidence[1]!.isSampleEvidence).toBe(true);
  });

  it("必須3文言を含むdisclaimerをそのまま透過する(新たな文言を作らない)", () => {
    const disclaimer =
      "これはAIによるリスクチェックであり、法令違反を断定するものではありません。最終判断は医院または専門家が行ってください。";
    const vm = buildAdComplianceViewModel({ findings: [], disclaimer, checkedAt: "x" });
    expect(vm.disclaimer).toBe(disclaimer);
    expect(vm.disclaimer).toContain("AIによるリスクチェック");
    expect(vm.disclaimer).toContain("法令違反を断定するものではありません");
    expect(vm.disclaimer).toContain("最終判断は医院または専門家が行ってください");
  });
});

describe("buildMeasurementViewModel(計測条件・データソース)", () => {
  it("領域ごとのstatusを件数集計してサマリー文字列を作る", () => {
    const domains: DomainScore[] = [
      domainScore({ domain: "AIO", status: "measured" }),
      domainScore({ domain: "MEO", status: "estimated" }),
      domainScore({ domain: "SEO", status: "partial" }),
      domainScore({ domain: "LLMO", status: "unavailable" }),
      domainScore({ domain: "WEB_BOOKING", status: "unavailable" }),
      domainScore({ domain: "REVIEWS", status: "measured" }),
    ];
    const vm = buildMeasurementViewModel("2026-09-06T00:00:00.000Z", "disclaimer", domains, false);
    expect(vm.domainSourceSummary).toBe("実測2領域 / 推定1領域 / 一部取得1領域 / 取得不能2領域");
  });

  it("2026-09-06のユーザー指示⑧: summaryLabelは院長向けの定型文で、生のdataDisclaimerをそのまま出さない", () => {
    const rawDisclaimer =
      "このレポートはP0開発中のモックデータです。ChatGPT/Gemini等の実プロバイダーには接続していません。";
    const vm = buildMeasurementViewModel("2026-09-06T00:00:00.000Z", rawDisclaimer, [], true);
    expect(vm.summaryLabel).not.toContain("P0");
    expect(vm.summaryLabel).not.toContain("ChatGPT");
    expect(vm.summaryLabel).not.toContain("Gemini");
    // 生データは技術的な注記として保持する(詳細表示側で使う想定。捨てない)。
    expect(vm.technicalDisclaimer).toBe(rawDisclaimer);
  });
});

describe("normalizeLegacyDataDisclaimer", () => {
  const legacy =
    "このレポートはP0開発中のモックデータです。ChatGPT/Gemini等の実プロバイダーには接続していません。";

  it("保存済みの古い固定文面を、実測と参考の混在表示へ補正する", () => {
    const normalized = normalizeLegacyDataDisclaimer(
      legacy,
      [
        questionResult({
          measurementCoverage: {
            totalProviders: 1,
            measuredProviders: 1,
            referenceProviders: 0,
            unavailableProviders: 0,
            isPartial: false,
          },
        }),
        questionResult({ measurementCoverage: null }),
      ],
      true
    );
    expect(normalized).toContain("実測データと参考データが混在");
    expect(normalized).not.toContain("実プロバイダーには接続していません");
  });

  it("canonical取得状況がない古い結果は参考データとして補正する", () => {
    const normalized = normalizeLegacyDataDisclaimer(legacy, [questionResult()], true);
    expect(normalized).toContain("参考データに基づく診断");
  });

  it("新しい文面は変更しない", () => {
    const current = "現在の正確な注意書き";
    expect(normalizeLegacyDataDisclaimer(current, [], true)).toBe(current);
  });
});

describe("buildFreeDiagnosisResultViewModel(統合)", () => {
  it("aioLossRootCausesが永続化されていなくても、questionResultsから再集約して構築する", () => {
    const data: DiagnosisResultData = {
      clinicId: "c1",
      clinicName: "テスト歯科クリニック",
      clinicUrl: "https://example.com",
      totalPoints: 60,
      totalStatus: "measured",
      scoreBreakdown: {
        domains: [
          domainScore({ domain: "AIO" }),
          domainScore({ domain: "MEO" }),
          domainScore({ domain: "SEO" }),
          domainScore({ domain: "LLMO" }),
          domainScore({ domain: "WEB_BOOKING" }),
          domainScore({ domain: "REVIEWS" }),
        ],
        maxPoints: 100,
        assessedMaxPoints: 100,
        coverage: 1,
      },
      competitors: [{ id: "c1", name: "競合A" }],
      questionResults: [
        questionResult({
          question: "質問A",
          status: "lose",
          rootCauseKey: "AIO:ai_search_presence",
          rootCauseLabel: "AIの回答に自院が表示されていない",
          confidence: "medium",
          sourceType: "canonical_measurement",
          attributionStatus: "attributed",
          analysisVersion: "v1",
        }),
      ],
      topImprovements: [],
      adComplianceChecks: { findings: [], disclaimer: "d", checkedAt: "x" },
      isSample: true,
      dataDisclaimer: "このレポートはP0開発中のモックデータです。",
      measuredAt: new Date("2026-09-06T00:00:00.000Z"),
    };

    const vm = buildFreeDiagnosisResultViewModel(data);
    expect(vm.sampleBanner.show).toBe(true);
    expect(vm.lossRootCauses).toHaveLength(1);
    expect(vm.lossRootCauses[0]!.questions[0]!.question).toBe("質問A");
    expect(vm.domains.map((d) => d.domain)).toEqual(DOMAIN_DISPLAY_ORDER);
  });
});


describe("buildQuestionResultViewModel(evidenceの内部表現除去、2026-09-06のユーザー指示②)", () => {
  it("[chatgpt]/[mock]のような角括弧タグをevidence本文から取り除き、構造化する", () => {
    const vm = buildQuestionResultViewModel(
      questionResult({ evidence: ["[chatgpt] [mock] \"質問\" への回答で言及なし"] })
    );
    expect(vm.evidence).toEqual([
      { text: '"質問" への回答で言及なし', providerLabel: "ChatGPT", isSample: true },
    ]);
  });

  it("角括弧タグが無いevidenceはそのままtextとして扱う(providerLabel/isSampleはnull/false)", () => {
    const vm = buildQuestionResultViewModel(questionResult({ evidence: ["特に補足なし"] }));
    expect(vm.evidence).toEqual([{ text: "特に補足なし", providerLabel: null, isSample: false }]);
  });
});

function improvementCandidate(overrides: Partial<ImprovementCandidate> = {}): ImprovementCandidate {
  return {
    title: "タイトル",
    domain: "AIO",
    detectedFact: "検出事実",
    patientImpact: "患者影響",
    recommendedAction: "まずやること",
    impact: "high",
    confidence: "medium",
    urgency: "low",
    evidence: [],
    key: "k1",
    kind: "standard",
    recommendedAssignee: "院長",
    ruleKey: "rule:1",
    rootCauseKey: "AIO:x",
    evidenceDomain: "AIO",
    provisional: true,
    sourceCriteria: [],
    structuredEvidence: [],
    ...overrides,
  };
}

describe("buildImprovementViewModel(改善TOP3の内部表現除去、2026-09-06のユーザー指示⑤)", () => {
  it("impact/confidence/urgency(high/medium/low)を高/中/低の単独ラベルへ変換する", () => {
    const vm = buildImprovementViewModel(improvementCandidate());
    expect(vm.impactLabel).toBe("高");
    expect(vm.confidenceLabel).toBe("中");
    expect(vm.urgencyLabel).toBe("低");
  });

  it("recommendedActionを「まずやること」(firstAction)としてそのまま使う", () => {
    const vm = buildImprovementViewModel(improvementCandidate({ recommendedAction: "口コミ返信を追加する" }));
    expect(vm.firstAction).toBe("口コミ返信を追加する");
  });

  it("dataGapが無い場合はdataGapReasonがnullになる", () => {
    const vm = buildImprovementViewModel(improvementCandidate({ dataGap: undefined }));
    expect(vm.dataGapReason).toBeNull();
  });
});
