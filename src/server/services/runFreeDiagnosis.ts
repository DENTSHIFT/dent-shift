import {
  calculateScoreBreakdown,
  domainAchievementRate,
  type DomainScoreInput,
} from "@/domain/diagnosis/scoring";
import type { DiagnosisScoreBreakdown, DomainKey } from "@/domain/diagnosis/types";
import type { CompetitorClinic, PatientQuestionResult } from "@/domain/competitor/types";
import type { ImprovementCandidate } from "@/domain/improvement-task/types";
import type { AiProvider } from "@/server/providers/ai/types";
import type { CompetitorProvider } from "@/server/providers/competitor/types";
import { seededRandom } from "@/lib/prng";

export interface RunFreeDiagnosisInput {
  clinicName: string;
  clinicUrl: string;
  contactEmail: string;
  // 任意項目。未入力の場合、対応するdomainは"unavailable"として扱う(0点にしない)
  gbpUrl?: string;
  bookingUrl?: string;
}

export interface RunFreeDiagnosisResult {
  clinicName: string;
  clinicUrl: string;
  scoreBreakdown: DiagnosisScoreBreakdown;
  competitors: CompetitorClinic[];
  questionResults: PatientQuestionResult[];
  topImprovements: ImprovementCandidate[];
  // 引き継ぎ書3章-12: 推定/サンプルであることを常に明示する
  dataDisclaimer: string;
  measuredAt: string;
}

// P0のvertical slice用に固定した患者質問セット(引き継ぎ書9章の軸から抜粋)
const PATIENT_QUESTIONS = [
  "駅から近いおすすめの歯医者は?",
  "痛みが少ないインプラント治療ができる歯科医院は?",
  "土日も診療している歯科医院は?",
  "子供を連れて行きやすい小児歯科は?",
  "評判の良い歯科医院を教えて",
  "ホワイトニングの料金が分かりやすい歯科医院は?",
];

export interface RunFreeDiagnosisDeps {
  aiProvider: AiProvider;
  competitorProvider: CompetitorProvider;
}

export class InvalidDiagnosisInputError extends Error {}

function validateInput(input: RunFreeDiagnosisInput) {
  if (!input.clinicName?.trim()) {
    throw new InvalidDiagnosisInputError("医院名は必須です");
  }
  if (!input.clinicUrl?.trim() || !/^https?:\/\//.test(input.clinicUrl.trim())) {
    throw new InvalidDiagnosisInputError("公式サイトURLは http(s):// から始まる形式で入力してください");
  }
  if (!input.contactEmail?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.contactEmail.trim())) {
    throw new InvalidDiagnosisInputError("メールアドレスの形式が正しくありません");
  }
  // 電話番号は仕様上そもそも収集しない(引き継ぎ書3章-4)。入力欄自体を用意しない。
}

/**
 * 無料60秒AI集患診断のユースケース(引き継ぎ書 Step3 / IMPLEMENTATION_PLAN.md Step3)。
 * このサービス層が「絶対に変えてはいけない事業ルール」を強制する場所になる:
 * - 取得不能なdomainを0点として扱わない
 * - すべての結果にmock/推定である旨のdisclaimerを付与する
 * - 外部への書き込みは一切行わない(読み取り専用のvertical slice)
 */
export async function runFreeDiagnosis(
  input: RunFreeDiagnosisInput,
  deps: RunFreeDiagnosisDeps
): Promise<RunFreeDiagnosisResult> {
  validateInput(input);

  const competitors = await deps.competitorProvider.findNearbyCompetitors(
    input.clinicName,
    input.clinicUrl
  );

  const aiObservations = await deps.aiProvider.observe({
    clinicName: input.clinicName,
    clinicUrl: input.clinicUrl,
    patientQuestions: PATIENT_QUESTIONS,
    competitors,
  });

  const scoreBreakdown = buildScoreBreakdown(input, aiObservations);
  const questionResults = buildQuestionResults(aiObservations);
  const topImprovements = buildTopImprovements(scoreBreakdown, questionResults);

  return {
    clinicName: input.clinicName,
    clinicUrl: input.clinicUrl,
    scoreBreakdown,
    competitors,
    questionResults,
    topImprovements,
    dataDisclaimer:
      "このレポートはP0開発中のモックデータです。ChatGPT/Gemini等の実プロバイダーには接続していません。数値は実際の集患成果を保証するものではありません。",
    measuredAt: new Date().toISOString(),
  };
}

function buildScoreBreakdown(
  input: RunFreeDiagnosisInput,
  aiObservations: Awaited<ReturnType<AiProvider["observe"]>>
): DiagnosisScoreBreakdown {
  const mentionRate =
    aiObservations.length === 0
      ? 0
      : aiObservations.filter((o) => o.mentioned).length / aiObservations.length;

  const rand = seededRandom(`domain-score:${input.clinicName}`);

  const inputs: DomainScoreInput[] = [
    {
      domain: "AIO",
      status: "measured",
      points: Math.round(mentionRate * 30),
      evidence: [
        `[mock] ${aiObservations.length}件のAI観測のうち ${Math.round(mentionRate * 100)}% で言及あり`,
      ],
    },
    input.gbpUrl
      ? {
          domain: "MEO",
          status: "measured",
          points: Math.round(rand() * 20),
          evidence: [`[mock] GBP URL(${input.gbpUrl})を基にした仮スコア`],
        }
      : {
          domain: "MEO",
          status: "unavailable",
          evidence: ["GBP(Googleビジネスプロフィール)のURLが未入力のため測定できません"],
        },
    {
      domain: "SEO",
      status: "estimated",
      points: Math.round(rand() * 15),
      evidence: ["[推定] P0では実クロールを行わず、URL構造からの簡易推定値です"],
    },
    {
      domain: "LLMO",
      status: "estimated",
      points: Math.round(rand() * 15),
      evidence: ["[推定] AI回答での引用のされやすさに関する簡易推定値です"],
    },
    input.bookingUrl
      ? {
          domain: "WEB_BOOKING",
          status: "measured",
          points: Math.round(rand() * 10),
          evidence: [`[mock] 予約導線URL(${input.bookingUrl})を基にした仮スコア`],
        }
      : {
          domain: "WEB_BOOKING",
          status: "unavailable",
          evidence: ["Web予約導線のURLが未入力のため測定できません"],
        },
    {
      domain: "REVIEWS",
      status: "estimated",
      points: Math.round(rand() * 10),
      evidence: ["[推定] 口コミ件数・鮮度に関する簡易推定値です"],
    },
  ];

  return calculateScoreBreakdown(inputs);
}

function buildQuestionResults(
  aiObservations: Awaited<ReturnType<AiProvider["observe"]>>
): PatientQuestionResult[] {
  const byQuestion = new Map<string, typeof aiObservations>();
  for (const obs of aiObservations) {
    const list = byQuestion.get(obs.question) ?? [];
    list.push(obs);
    byQuestion.set(obs.question, list);
  }

  return Array.from(byQuestion.entries()).map(([question, observations]) => {
    const mentionedCount = observations.filter((o) => o.mentioned).length;
    const bestRank = Math.min(
      ...observations.map((o) => o.recommendationRank ?? Infinity)
    );

    let status: PatientQuestionResult["status"];
    if (mentionedCount === 0) status = "lose";
    else if (mentionedCount === observations.length && bestRank <= 1) status = "win";
    else status = "close";

    return {
      question,
      status,
      evidence: observations.map((o) => `[${o.aiProvider}] ${o.evidence}`),
    };
  });
}

function buildTopImprovements(
  scoreBreakdown: DiagnosisScoreBreakdown,
  questionResults: PatientQuestionResult[]
): ImprovementCandidate[] {
  const candidates: ImprovementCandidate[] = [];

  for (const domainScore of scoreBreakdown.domains) {
    const rate = domainAchievementRate(domainScore);
    // unavailableなdomainは「まず測定できる状態にする」ことを最優先の改善候補にする
    if (domainScore.status === "unavailable") {
      candidates.push({
        title: `${domainLabel(domainScore.domain)}の情報を登録し、診断を可能にする`,
        domain: domainScore.domain,
        detectedFact: `${domainLabel(domainScore.domain)}に関する情報が未登録のため、現状を測定できていません`,
        patientImpact: "測定できない領域は改善の判断材料にもならず、機会損失を見逃すリスクがあります",
        recommendedAction: "該当情報(URL等)を登録し、次回診断で状態を可視化してください",
        impact: "medium",
        confidence: "high",
        urgency: "medium",
        evidence: domainScore.evidence,
      });
      continue;
    }
    if (rate !== null && rate < 0.5) {
      candidates.push({
        title: `${domainLabel(domainScore.domain)}の改善余地が大きい`,
        domain: domainScore.domain,
        detectedFact: `${domainLabel(domainScore.domain)}: ${domainScore.points}/${domainScore.maxPoints}点`,
        patientImpact: "この領域が弱いと、AIが患者に自院を推薦する機会が減っている可能性があります",
        recommendedAction: "詳細レポートの該当セクションを確認し、優先度の高い項目から着手してください",
        impact: rate < 0.3 ? "high" : "medium",
        confidence: domainScore.status === "estimated" ? "medium" : "high",
        urgency: rate < 0.3 ? "high" : "medium",
        evidence: domainScore.evidence,
      });
    }
  }

  const losingQuestions = questionResults.filter((q) => q.status === "lose");
  if (losingQuestions.length > 0) {
    candidates.push({
      title: "AIに選ばれていない患者質問への対応",
      domain: "AIO",
      detectedFact: `${losingQuestions.length}件の患者質問でAIに自院が挙がっていません(例: 「${losingQuestions[0].question}」)`,
      patientImpact: "これらの質問で検討している患者に、競合医院を先に案内されている可能性があります",
      recommendedAction: "該当する質問に対応する診療ページ・FAQを拡充してください",
      impact: "high",
      confidence: "medium",
      urgency: "high",
      evidence: losingQuestions.flatMap((q) => q.evidence).slice(0, 3),
    });
  }

  // 優先度(緊急性→インパクト)でソートしTOP3のみ返す(引き継ぎ書12章: 主画面はTOP3を優先)
  const weight = { high: 3, medium: 2, low: 1 } as const;
  candidates.sort(
    (a, b) =>
      weight[b.urgency] * weight[b.impact] - weight[a.urgency] * weight[a.impact]
  );

  return candidates.slice(0, 3);
}

function domainLabel(domain: DomainKey): string {
  const labels: Record<DomainKey, string> = {
    AIO: "AIO(AI最適化)",
    MEO: "MEO(マップ検索)",
    SEO: "SEO",
    LLMO: "LLMO",
    WEB_BOOKING: "Web予約導線",
    REVIEWS: "口コミ・信頼性",
  };
  return labels[domain];
}
