import { seededRandom } from "@/lib/prng";
import type { AdRiskCategoryKey, AdRiskMatchStrength, AdRiskSeverity, RawAdRiskFinding } from "@/domain/ad-compliance/types";
import type { AdComplianceCheckInput, AdComplianceProvider } from "./types";

// 「開発用mock・実測ではない」ことを検出理由に必ず含める(正本の絶対ルール3章-12準拠、mockScoreProviderと同じ方針)
const MOCK_DISCLAIMER = "開発用mock・実測ではありません";

interface MockScenario {
  category: AdRiskCategoryKey;
  quotedText: string;
  sourceLocation: string;
  /** 発火する確率(0〜1)。開発用の目安値であり実データ調整前の暫定値 */
  fireProbability: number;
  /** このカテゴリで典型的に想定するseverity(mock上の目安。other_general_riskは常にドメイン層でmedium以下に補正される) */
  typicalSeverity: AdRiskSeverity;
}

// P0のvertical slice用に固定したシナリオ集(正本§13.1の11分類それぞれに1例ずつ)
const MOCK_SCENARIOS: MockScenario[] = [
  {
    category: "superlative_exaggeration",
    quotedText: "当院は日本一の技術力で必ず治療を成功させます",
    sourceLocation: "トップページ本文",
    fireProbability: 0.35,
    typicalSeverity: "high",
  },
  {
    category: "comparative_superiority",
    quotedText: "他院よりも圧倒的に優れた治療法です",
    sourceLocation: "診療案内ページ本文",
    fireProbability: 0.3,
    typicalSeverity: "medium",
  },
  {
    category: "safety_assertion",
    quotedText: "痛みは一切ありませんので安心して受けられます",
    sourceLocation: "インプラント治療ページ本文",
    fireProbability: 0.35,
    typicalSeverity: "high",
  },
  {
    category: "efficacy_assertion",
    quotedText: "必ず白い歯になります",
    sourceLocation: "ホワイトニングページ本文",
    fireProbability: 0.35,
    typicalSeverity: "high",
  },
  {
    category: "unfounded_numbers",
    quotedText: "治療成功率99%(自社調べ、出典記載なし)",
    sourceLocation: "インプラント治療ページ本文",
    fireProbability: 0.3,
    typicalSeverity: "medium",
  },
  {
    category: "self_pay_disclosure_gap",
    quotedText: "自由診療メニューのページに費用・期間・リスクの記載が見当たりません",
    sourceLocation: "自由診療ページ(ホワイトニング)",
    fireProbability: 0.4,
    typicalSeverity: "medium",
  },
  {
    category: "patient_testimonial",
    quotedText: "患者様の声: 「治療のおかげで人生が変わりました」",
    sourceLocation: "お客様の声セクション",
    fireProbability: 0.3,
    typicalSeverity: "medium",
  },
  {
    category: "before_after_gap",
    quotedText: "ビフォーアフター画像の近辺に個人差・治療期間・費用の記載が見当たりません",
    sourceLocation: "症例紹介ページ(ビフォーアフター画像周辺)",
    fireProbability: 0.35,
    typicalSeverity: "medium",
  },
  {
    category: "review_incentive",
    quotedText: "高評価の口コミを書いていただいた方に特典をプレゼント",
    sourceLocation: "口コミ投稿案内ページ",
    fireProbability: 0.25,
    typicalSeverity: "high",
  },
  {
    category: "other_general_risk",
    quotedText: "分類基準に直接一致しないが、念のため確認が望ましい表現",
    sourceLocation: "診療案内ページ本文",
    fireProbability: 0.15,
    typicalSeverity: "medium",
  },
];

const MATCH_STRENGTH_WEIGHTS: Array<{ value: AdRiskMatchStrength; weight: number }> = [
  { value: "direct", weight: 0.4 },
  { value: "partial", weight: 0.35 },
  { value: "inferred", weight: 0.25 },
];

function pickMatchStrength(rand: () => number): AdRiskMatchStrength {
  const roll = rand();
  let cumulative = 0;
  for (const { value, weight } of MATCH_STRENGTH_WEIGHTS) {
    cumulative += weight;
    if (roll < cumulative) return value;
  }
  return "inferred";
}

// 口コミ返信文の中にPIIらしき文字列(電話番号)が含まれるかを検出する簡易パターン。
// マスキング自体はdomain層(buildAdComplianceResult)の責務であり、ここでは検出のみ行う。
const PHONE_LIKE_PATTERN = /0\d{1,4}-\d{1,4}-\d{3,4}/;

/**
 * P0用のモック医療広告AIチェックprovider。
 *
 * 決定論的な擬似乱数(seededRandom)は、この provider 層に完全に閉じ込める。
 * domain層(ad-compliance/*)には一切の乱数・非決定的処理を持ち込まない
 * (mockScoreProvider/mockAiProviderと同じ方針)。
 *
 * confidenceは一切ここで決めない(matchStrengthのみを返す)。confidenceの導出は
 * ドメイン層(riskCatalog.tsのderiveConfidence)の責務であり、providerが
 * 「evidence不足なのに確信度が高い」と主張することを構造的に防いでいる(追加条件2)。
 *
 * 患者の個人情報は生成しない・保持しない(追加条件5)。口コミ返信文は呼び出し元(P0では
 * 空配列が渡ることが多い)から受け取ったテキストをパターン検出するのみで、この provider が
 * 独自に患者情報を作り出すことはない。
 */
export class MockAdComplianceProvider implements AdComplianceProvider {
  readonly name = "mock-ad-compliance-provider";

  async check(input: AdComplianceCheckInput): Promise<RawAdRiskFinding[]> {
    const findings: RawAdRiskFinding[] = [];

    for (const scenario of MOCK_SCENARIOS) {
      const rand = seededRandom(`ad-compliance:${input.clinicName}:${scenario.category}`);
      const fireRoll = rand();
      if (fireRoll >= scenario.fireProbability) continue;
      const matchStrength = pickMatchStrength(rand);
      findings.push({
        category: scenario.category,
        severity: scenario.typicalSeverity,
        matchStrength,
        quotedText: scenario.quotedText,
        sourceLocation: scenario.sourceLocation,
        detectionReason: `[${MOCK_DISCLAIMER}] パターン辞書照合(開発用シナリオ: ${scenario.category})`,
        // MOCK_SCENARIOSはseededRandomで発火させる開発用の固定シナリオであり、実際の医院の
        // ページ内容を検査した結果ではない。sourceType="mock"により、この所見が
        // isEscalationEligible()でTOP3への強制エスカレーション対象から必ず除外される
        // (2026-09-05のユーザー指示: mock由来のリスクを実際の重大リスクとして扱わない)。
        sourceType: "mock",
      });
    }

    findings.push(...this.checkReviewResponsesForPii(input.reviewResponseTexts ?? []));

    return findings;
  }

  private checkReviewResponsesForPii(reviewResponseTexts: string[]): RawAdRiskFinding[] {
    const findings: RawAdRiskFinding[] = [];
    reviewResponseTexts.forEach((text, index) => {
      if (!PHONE_LIKE_PATTERN.test(text)) return;
      findings.push({
        category: "review_response_pii",
        severity: "high",
        matchStrength: "direct",
        quotedText: text,
        sourceLocation: `口コミ返信(${index + 1}件目)`,
        // こちらはMOCK_SCENARIOSのような擬似乱数シナリオではなく、呼び出し元から渡された
        // 実際のreviewResponseTexts(実テキスト)に対する決定論的な正規表現検出であるため、
        // sourceType="mock"にはしない(2026-09-05のユーザー指示: 実テキスト検出はmockと分離する)。
        detectionReason: "電話番号らしき文字列パターンに直接一致(実テキストに対する決定論的検出)",
        sourceType: "review_text",
      });
    });
    return findings;
  }
}
