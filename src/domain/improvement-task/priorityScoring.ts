import { DOMAIN_ORDER, getDomainMaxPoints } from "../diagnosis/scoreCriteria";
import type {
  CriterionEvidence,
  CriterionScore,
  DiagnosisScoreBreakdown,
  DomainKey,
  DomainScore,
  UnavailableReason,
} from "../diagnosis/types";
import type { PatientQuestionResult } from "../competitor/types";
import { getAdRiskCategoryDefinition } from "../ad-compliance/riskCatalog";
import type { AdRiskFinding } from "../ad-compliance/types";
import {
  IMPROVEMENT_RULE_CATALOG,
  type CatalogPriority,
  type CriterionRef,
  type ImprovementRuleDefinition,
  type RippleHint,
} from "./candidateCatalog";
import {
  ESCALATION_CATEGORY_ORDER,
  type EscalationConfidence,
  type EscalationSeverity,
  type ImpactLevel,
  type ImprovementCandidate,
  type PriorityAxisScores,
  type PriorityTier,
} from "./types";

/**
 * 改善TOP3生成ロジックの本体(2026-09-05 承認分、同日の構造再整理を反映)。
 * generateImprovementCandidates() → scoreImprovementCandidates() → deduplicateByRootCause()
 * → rankImprovementCandidates() → selectTopImprovements() の5段階に責務分離する
 * (将来、全候補一覧を表示する際もgenerate/score/dedup/rankまでの結果をそのまま再利用できるようにするため)。
 *
 * 現在の公開契約(RunFreeDiagnosisResult.topImprovements)はTOP3のみを返す。
 * 全候補一覧の返却は今回のスコープ外(2026-09-05のユーザー指示)。
 */

// ---- データ不足として扱う対象(診断・予約計測そのものを阻害しうるdomain) ----
const CRITICAL_BLOCKING_DOMAINS: DomainKey[] = ["WEB_BOOKING", "AIO"];

const DOMAIN_LABEL: Record<DomainKey, string> = {
  AIO: "AIO(AI最適化)",
  MEO: "MEO(マップ検索)",
  SEO: "SEO",
  LLMO: "LLMO",
  WEB_BOOKING: "Web予約導線",
  REVIEWS: "口コミ・信頼性",
};

export function domainLabel(domain: DomainKey): string {
  return DOMAIN_LABEL[domain];
}

const DATA_GAP_REASON_BY_DOMAIN: Partial<Record<DomainKey, string>> = {
  MEO: "GBP(Googleビジネスプロフィール)のURLが未入力のため測定できません",
  WEB_BOOKING: "Web予約導線のURLが未入力のため測定できません",
};

/**
 * evidenceRequirements[]/triggerRules[]が参照するcriterionを、診断結果から引き当てる。
 * 見つからない場合(domain自体が結果に存在しない等)はundefinedを返す。
 */
function findCriterion(domainByKey: Map<DomainKey, DomainScore>, ref: CriterionRef): CriterionScore | undefined {
  const domainScore = domainByKey.get(ref.domain);
  if (!domainScore) return undefined;
  return domainScore.criteria.find((c) => c.key === ref.criterionKey);
}

function ratioOf(criterion: CriterionScore): number {
  return criterion.maxScore === 0 ? 0 : (criterion.score ?? 0) / criterion.maxScore;
}

/**
 * evidenceRequirements[]で列挙された全criterionが取得可能(unavailableでない)かを判定する。
 * いずれかが未取得/unavailableの場合、この候補は生成しない
 * (2026-09-05のユーザー指示 要件4: 推測で独立シグナルを捏造して発火させない)。
 */
function isEvidenceAvailable(rule: ImprovementRuleDefinition, domainByKey: Map<DomainKey, DomainScore>): boolean {
  return rule.evidenceRequirements.every((req) => {
    const criterion = findCriterion(domainByKey, req.criterion);
    return criterion !== undefined && criterion.status !== "unavailable";
  });
}

/**
 * triggerRules[](AND評価)がすべて満たされるかを判定する。P0はratio_belowのみサポートする。
 * primaryCriterion(現diagnosticAnchor)を「唯一の発火条件」として直接扱わず、
 * この関数を経由することで将来の複数条件化に備える(2026-09-05のユーザー指示 要件1)。
 */
function evaluateTriggerRules(rule: ImprovementRuleDefinition, domainByKey: Map<DomainKey, DomainScore>): boolean {
  return rule.triggerRules.every((trigger) => {
    const criterion = findCriterion(domainByKey, trigger.criterion);
    if (!criterion || criterion.status === "unavailable") return false;
    if (trigger.comparator === "ratio_below") {
      return ratioOf(criterion) < trigger.threshold;
    }
    return false;
  });
}

// ---- 内部の中間表現(4軸スコア算出に必要な入力を、公開型に出さずに橋渡しする) ----
export interface DraftImprovementCandidate
  extends Omit<ImprovementCandidate, "priority" | "impact" | "confidence" | "urgency" | "evidence"> {
  axisInput?: { catalogPriority: CatalogPriority; rippleHint: RippleHint };
}

export interface GenerateCandidatesInput {
  breakdown: DiagnosisScoreBreakdown;
  questionResults: PatientQuestionResult[];
  /**
   * 医療広告AIチェック(src/domain/ad-compliance)の所見(2026-09-05のユーザー指示 追加条件6)。
   * escalationEligible=trueの所見のみ、legal_medical_ad_privacyエスカレーションとして
   * 改善TOP3に合流する(generateAdComplianceCandidates参照)。未指定時は連携しない(既存動作を維持)。
   */
  adComplianceFindings?: AdRiskFinding[];
}

/**
 * Step1: 6領域の診断結果・質問結果から改善候補の「種」を検出する。
 * - 正本カタログ45項目(candidateCatalog.ts)を評価する
 * - domain全体がunavailableな場合は個別criterionのルールを評価せず、data_gap候補を1件だけ生成する
 *   (7.1節: 一部criterionのみunavailableな場合は当該criterionのルールを単に発火させない)
 * - AIOの質問結果からinsufficient_data/lose候補を生成する(4章: insufficient_dataは推測採点しない)
 */
export function generateImprovementCandidates(input: GenerateCandidatesInput): DraftImprovementCandidate[] {
  const { breakdown, questionResults, adComplianceFindings } = input;
  const domainByKey = new Map<DomainKey, DomainScore>(breakdown.domains.map((d) => [d.domain, d]));
  const drafts: DraftImprovementCandidate[] = [];

  for (const domainScore of breakdown.domains) {
    if (domainScore.status === "unavailable") {
      drafts.push(buildDataGapCandidate(domainScore));
    }
  }

  for (const rule of IMPROVEMENT_RULE_CATALOG) {
    // evidenceRequirements[]: 必要なcriterionが揃っていない場合はこの候補を生成しない
    // (data_gap側で扱い済み、または対象外。推測で独立シグナルを捏造して発火させない)
    if (!isEvidenceAvailable(rule, domainByKey)) continue;
    // triggerRules[](AND評価): primaryCriterion(現diagnosticAnchor)を唯一の発火条件として
    // 直接見るのではなく、この関数を経由して評価する(将来の複数条件化に備える)
    if (!evaluateTriggerRules(rule, domainByKey)) continue; // 健全なので発火しない

    const anchorCriterion = findCriterion(domainByKey, rule.diagnosticAnchor)!; // 上の評価で存在確認済み
    const ratio = ratioOf(anchorCriterion);
    const evidence: CriterionEvidence[] = anchorCriterion.evidence;
    const draft: DraftImprovementCandidate = {
      key: rule.key,
      ruleKey: rule.ruleKey,
      rootCauseKey: rule.rootCauseKey,
      kind: rule.escalationCategory ? "risk_escalation" : "standard",
      domain: rule.displayDomain,
      evidenceDomain: rule.evidenceDomain,
      provisional: rule.provisional,
      title: `${domainLabel(rule.displayDomain)}: ${rule.label}`,
      detectedFact: `${rule.label}(${anchorCriterion.label}: ${anchorCriterion.score ?? 0}/${anchorCriterion.maxScore}点)`,
      patientImpact:
        "この状態が続くと、AIの回答・検索結果・予約導線のいずれかで患者への露出や信頼形成の機会を損なう可能性があります",
      recommendedAction: rule.generatedAction,
      recommendedAssignee: rule.recommendedAssignee,
      sourceCriteria: [rule.diagnosticAnchor],
      structuredEvidence: evidence,
      axisInput: { catalogPriority: rule.catalogPriority, rippleHint: rule.rippleHint },
    };

    if (rule.escalationCategory) {
      draft.escalation = {
        category: rule.escalationCategory,
        severity: ratio === 0 ? "critical" : "high",
        confidence: anchorCriterion.status === "measured" ? "high" : "medium",
        reason: `${rule.label}(${anchorCriterion.label})が正本§8の重大リスク条件に該当します`,
      };
    }

    drafts.push(draft);
  }

  drafts.push(...generateAioQuestionCandidates(questionResults, domainByKey));
  drafts.push(...generateAdComplianceCandidates(adComplianceFindings ?? []));

  return drafts;
}

/**
 * 医療広告AIチェックの所見から、TOP3への強制エスカレーション候補を生成する
 * (2026-09-05のユーザー指示 追加条件6: legal_medical_ad_privacyとして既存escalationロジックへ接続)。
 * escalationEligible=falseの所見(severity=high+confidence低、またはmedium/low)は
 * ここでは候補化しない(adComplianceChecks側の独立表示にのみ現れる)。
 * confidence="high"→escalation severity"critical"、confidence="medium"→"high"とする
 * (escalationEligibleの定義上、この2値以外はここに到達しない)。
 */
function generateAdComplianceCandidates(findings: AdRiskFinding[]): DraftImprovementCandidate[] {
  return findings
    .filter((finding) => finding.escalationEligible)
    .map((finding) => {
      const categoryDef = getAdRiskCategoryDefinition(finding.category);
      const escalationSeverity = finding.confidence === "high" ? "critical" : "high";
      const escalationConfidence = finding.confidence === "high" ? "high" : "medium";
      return {
        key: `ad-compliance-${finding.id}`,
        ruleKey: `ad-compliance:${finding.category}`,
        // 45項目カタログのrootCauseKey(`${DomainKey}:${criterionKey}`形式)とは衝突しない専用形式。
        // finding.idごとに一意のため重複整理(deduplicateByRootCause)の対象にもならない。
        rootCauseKey: `ad-compliance:${finding.category}:${finding.id}`,
        kind: "risk_escalation",
        domain: "REVIEWS",
        evidenceDomain: "REVIEWS",
        // 45項目カタログの暫定マッピングとは異なる根拠(テキスト検査結果)に基づくためprovisionalではない
        provisional: false,
        title: `口コミ・信頼性: 医療広告AIチェックで検出されたリスク(${categoryDef.label})`,
        detectedFact: finding.displayMessage,
        patientImpact:
          "医療広告ガイドライン上のリスクが疑われる表現・欠落があり、患者の誤認や信頼低下、行政指導等のリスクにつながる可能性があります",
        recommendedAction: "該当箇所を確認し、必要に応じて表現の修正・削除を検討してください(AIによるリスクチェックであり、法令違反を断定するものではありません)",
        recommendedAssignee: finding.requiresReviewBy,
        sourceCriteria: [],
        structuredEvidence: finding.evidence.map((e) => ({
          summary: `${e.sourceLocation}: ${e.quotedText}`,
        })),
        axisInput: { catalogPriority: "urgent" as CatalogPriority, rippleHint: "moderate" as RippleHint },
        escalation: {
          category: "legal_medical_ad_privacy",
          severity: escalationSeverity,
          confidence: escalationConfidence,
          reason: `医療広告AIチェック(${categoryDef.label})で検出されたリスク(${finding.confidenceBasis})。最終判断は医院または専門家が行ってください。`,
        },
      };
    });
}

function buildDataGapCandidate(domainScore: DomainScore): DraftImprovementCandidate {
  const domain = domainScore.domain;
  const reason =
    DATA_GAP_REASON_BY_DOMAIN[domain] ?? `${domainLabel(domain)}に関する情報が未登録のため測定できません`;
  const blocking = CRITICAL_BLOCKING_DOMAINS.includes(domain);
  // domainScore.status==="unavailable"の場合、全criterionがunavailableであり(deriveAggregateStatus参照)、
  // かつscoring.tsの検証によりそれぞれが既にunavailableReasonを持つ。この候補生成ロジック自身が
  // 新たな理由を主張せず、根拠となったcriterionからそのまま機械的に引き継ぐ(2026-09-06のユーザー指示④)。
  const unavailableReason: UnavailableReason =
    domainScore.criteria.find((c) => c.status === "unavailable")?.unavailableReason ?? "not_provided";
  return {
    key: `data-gap-${domain}`,
    ruleKey: `improvement-logic:data-gap-${domain}`,
    // data_gapはcatalogのrootCauseKey体系とは独立した根拠(measured不能という事実そのもの)を持つため、
    // 専用の値を振り、standard候補の重複整理(deduplicateByRootCause)の対象にもしない
    rootCauseKey: `data-gap:${domain}`,
    evidenceDomain: domain,
    // カタログの45項目マッピングに依存しない(measured不能という構造的事実)ためprovisionalではない
    provisional: false,
    kind: "data_gap",
    domain,
    title: `${domainLabel(domain)}: まず確認が必要です(データ不足)`,
    detectedFact: reason,
    patientImpact:
      "医院の弱点と断定はできません。まず情報の登録・接続・確認が必要な状態です(測定できない項目は改善提案の対象になっていません)",
    recommendedAction: "該当情報(URL等)を登録・接続し、次回診断で状態を可視化してください",
    recommendedAssignee: "医院",
    sourceCriteria: domainScore.criteria.map((c) => ({ domain, criterionKey: c.key })),
    structuredEvidence: domainScore.criteria.flatMap((c) => c.evidence),
    dataGap: { status: "unavailable", reason, unavailableReason, blocking },
  };
}

function generateAioQuestionCandidates(
  questionResults: PatientQuestionResult[],
  domainByKey: Map<DomainKey, DomainScore>
): DraftImprovementCandidate[] {
  if (questionResults.length === 0) return [];

  const aioAlreadyDataGap = domainByKey.get("AIO")?.status === "unavailable";
  const allInsufficient = questionResults.every((q) => q.status === "insufficient_data");

  if (allInsufficient) {
    if (aioAlreadyDataGap) return []; // 重複防止(既にdomain全体のdata_gapで表現済み)
    const reason = "AIプロバイダーからの観測データが取得できず、AI集患診断の主要部分が実施できていません";
    return [
      {
        key: "data-gap-ai-observation",
        ruleKey: "improvement-logic:data-gap-ai-observation",
        rootCauseKey: "data-gap:ai-observation",
        evidenceDomain: "AIO",
        provisional: false,
        kind: "data_gap",
        domain: "AIO",
        title: "AIO(AI最適化): まず確認が必要です(データ不足)",
        detectedFact: reason,
        patientImpact: "医院の弱点と断定はできません。AI観測の接続・計測状況をまず確認してください",
        recommendedAction: "AIプロバイダー連携(ChatGPT/Gemini等)の接続状況を確認してください",
        recommendedAssignee: "制作会社",
        sourceCriteria: [],
        structuredEvidence: [{ summary: reason }],
        dataGap: { status: "insufficient_data", reason, unavailableReason: "insufficient_data", blocking: true },
      },
    ];
  }

  // insufficient_data(聞かれていない)は「負けている」とは断定しない(4章)ため母集団から除外する
  const losingQuestions = questionResults.filter((q) => q.status === "lose");
  if (losingQuestions.length === 0) return [];

  const firstLosingQuestion = losingQuestions[0]!;
  return [
    {
      key: "aio-losing-patient-questions",
      ruleKey: "improvement-logic:2-losing_patient_questions",
      // 個別の患者質問という、45項目カタログのcriterion達成率とは独立したevidence(実際のAI回答結果)を
      // 持つ候補のため、他候補と衝突しない専用のrootCauseKeyを振る(重複整理の対象にしない)
      rootCauseKey: "adhoc:aio-losing-patient-questions",
      evidenceDomain: "AIO",
      provisional: false,
      kind: "standard",
      domain: "AIO",
      title: "AIO(AI最適化): AIに選ばれていない患者質問への対応",
      detectedFact: `${losingQuestions.length}件の患者質問でAIに自院が挙がっていません(例: 「${firstLosingQuestion.question}」)`,
      patientImpact: "これらの質問で検討している患者に、競合医院を先に案内されている可能性があります",
      recommendedAction: "該当する質問に対応する診療ページ・FAQを拡充してください",
      recommendedAssignee: "医院／制作会社",
      sourceCriteria: [{ domain: "AIO", criterionKey: "question_domain_coverage" }],
      structuredEvidence: losingQuestions.flatMap((q) => q.evidence.map((e) => ({ summary: e }))).slice(0, 3),
      axisInput: { catalogPriority: "top", rippleHint: "moderate" },
    },
  ];
}

// ---- Step2: 4軸スコアリング ----

const IMPACT_BASE: Record<CatalogPriority, number> = { urgent: 5, top: 5, high: 4, normal: 3 };
const URGENCY_BASE: Record<CatalogPriority, number> = { urgent: 5, top: 5, high: 3, normal: 2 };
const RIPPLE_SCORE: Record<RippleHint, number> = { wide: 5, moderate: 3, narrow: 1 };

function clamp05(n: number): number {
  return Math.max(0, Math.min(5, n));
}

/** 配点が小さい領域(Web予約導線・口コミ=10点)は集患インパクトの基礎点をわずかに下方調整する */
function domainWeightAdjustment(domain: DomainKey): number {
  return getDomainMaxPoints(domain) >= 15 ? 0 : -1;
}

/** 推奨担当(正本カタログの表記)から実行容易性を判定する。関係者が少なく院内で完結するほど高得点。 */
function easeOfExecutionFromAssignee(assignee: string): number {
  if (assignee === "医院") return 5;
  if (assignee === "院長") return 4;
  if (assignee === "院長／受付" || assignee === "院長／事務長") return 4;
  if (assignee === "制作会社") return 3;
  if (assignee === "医院／制作会社" || assignee === "院長／制作会社") return 3;
  return 2;
}

/** 将来的な重み付けconfiguration化の余地を残すため、軸ごとのスコアを個別関数で算出する。P0では重み係数を導入しない(単純合計)。 */
export function computeAxisScores(
  catalogPriority: CatalogPriority,
  domain: DomainKey,
  recommendedAssignee: string,
  rippleHint: RippleHint
): PriorityAxisScores {
  return {
    catchmentImpact: clamp05(IMPACT_BASE[catalogPriority] + domainWeightAdjustment(domain)),
    urgency: clamp05(URGENCY_BASE[catalogPriority]),
    easeOfExecution: clamp05(easeOfExecutionFromAssignee(recommendedAssignee)),
    rippleEffect: clamp05(RIPPLE_SCORE[rippleHint]),
  };
}

export function tierFromTotal(total: number): PriorityTier {
  if (total >= 16) return "top";
  if (total >= 11) return "priority";
  if (total >= 6) return "normal";
  return "monitor";
}

function axisLevel(value: number): ImpactLevel {
  if (value >= 4) return "high";
  if (value >= 2) return "medium";
  return "low";
}

/**
 * Step2: generateImprovementCandidates()の出力に4軸優先度スコア(0-20点、重み付けなし)を付与する。
 * data_gap候補は推測採点しない(priorityを設定しない)。
 * 既存UI互換のimpact/confidence/urgency(ImpactLevel)もここで新ロジックから導出する。
 */
export function scoreImprovementCandidates(drafts: DraftImprovementCandidate[]): ImprovementCandidate[] {
  return drafts.map((draft) => {
    const { axisInput, ...rest } = draft;
    const evidence = draft.structuredEvidence.map((e) => e.summary);

    if (draft.kind === "data_gap") {
      const dataGap = draft.dataGap!;
      return {
        ...rest,
        evidence,
        impact: "medium",
        confidence: "low",
        urgency: dataGap.blocking ? "high" : "medium",
      };
    }

    if (!axisInput) {
      throw new Error(`improvement-task: axisInputが未設定です(key: ${draft.key})`);
    }
    const axes = computeAxisScores(axisInput.catalogPriority, draft.domain, draft.recommendedAssignee, axisInput.rippleHint);
    const total = axes.catchmentImpact + axes.urgency + axes.easeOfExecution + axes.rippleEffect;
    const priority = { axes, total, tier: tierFromTotal(total) };

    if (draft.kind === "risk_escalation") {
      const escalation = draft.escalation!;
      return {
        ...rest,
        evidence,
        priority,
        impact: axisLevel(axes.catchmentImpact),
        confidence: escalation.confidence === "high" ? "high" : "medium",
        urgency: "high",
      };
    }

    return {
      ...rest,
      evidence,
      priority,
      impact: axisLevel(axes.catchmentImpact),
      confidence: "medium",
      urgency: axisLevel(axes.urgency),
    };
  });
}

// ---- Step2.5: rootCauseKeyによる重複整理(standard種別のみ、risk_escalationは対象外) ----

/**
 * 同一のrootCauseKey(診断根拠)を共有するstandard種別の候補が、
 * 独立したevidence・副条件なしに共起しないよう、最も優先度の高い1件を代表として残す
 * (2026-09-05のユーザー指示 要件2)。
 * - risk_escalationはこの重複整理の対象外(重大リスクは通常の重複整理より優先される)。
 * - data_gapは推測採点をしない(priorityを持たない)ため、そもそもcompareStandardの対象にならない。
 * - rootCauseKeyがカタログ内で衝突しない候補(質問結果由来のadhoc:*、data-gap:*)は
 *   グループサイズが常に1になるため、実質的にそのまま残る。
 */
export function deduplicateByRootCause(scored: ImprovementCandidate[]): ImprovementCandidate[] {
  const standard = scored.filter((c) => c.kind === "standard");
  const others = scored.filter((c) => c.kind !== "standard");

  const byRootCause = new Map<string, ImprovementCandidate[]>();
  for (const candidate of standard) {
    const group = byRootCause.get(candidate.rootCauseKey) ?? [];
    group.push(candidate);
    byRootCause.set(candidate.rootCauseKey, group);
  }

  const representatives: ImprovementCandidate[] = [];
  for (const group of byRootCause.values()) {
    if (group.length === 1) {
      representatives.push(group[0]!);
      continue;
    }
    const [representative] = [...group].sort(compareStandard);
    representatives.push(representative!);
  }

  // 順序はこの後rankImprovementCandidatesが再ソートするため、ここでの並びは意味を持たない
  return [...others, ...representatives];
}

// ---- Step3: ランキング ----

const SEVERITY_RANK: Record<EscalationSeverity, number> = { critical: 0, high: 1 };
const CONFIDENCE_RANK: Record<EscalationConfidence, number> = { high: 0, medium: 1 };
const BLOCKING_DATA_GAP_DOMAIN_ORDER: DomainKey[] = ["WEB_BOOKING", "AIO"];

function compareEscalation(a: ImprovementCandidate, b: ImprovementCandidate): number {
  const ea = a.escalation!;
  const eb = b.escalation!;
  const categoryDiff = ESCALATION_CATEGORY_ORDER.indexOf(ea.category) - ESCALATION_CATEGORY_ORDER.indexOf(eb.category);
  if (categoryDiff !== 0) return categoryDiff;
  const severityDiff = SEVERITY_RANK[ea.severity] - SEVERITY_RANK[eb.severity];
  if (severityDiff !== 0) return severityDiff;
  const confidenceDiff = CONFIDENCE_RANK[ea.confidence] - CONFIDENCE_RANK[eb.confidence];
  if (confidenceDiff !== 0) return confidenceDiff;
  const totalDiff = (b.priority?.total ?? 0) - (a.priority?.total ?? 0);
  if (totalDiff !== 0) return totalDiff;
  return a.key.localeCompare(b.key);
}

function compareStandard(a: ImprovementCandidate, b: ImprovementCandidate): number {
  const totalDiff = b.priority!.total - a.priority!.total;
  if (totalDiff !== 0) return totalDiff;
  const axisOrder: Array<keyof PriorityAxisScores> = ["urgency", "catchmentImpact", "rippleEffect", "easeOfExecution"];
  for (const axis of axisOrder) {
    const diff = b.priority!.axes[axis] - a.priority!.axes[axis];
    if (diff !== 0) return diff;
  }
  const domainDiff = DOMAIN_ORDER.indexOf(a.domain) - DOMAIN_ORDER.indexOf(b.domain);
  if (domainDiff !== 0) return domainDiff;
  return a.key.localeCompare(b.key);
}

function compareBlockingDataGap(a: ImprovementCandidate, b: ImprovementCandidate): number {
  const ra = BLOCKING_DATA_GAP_DOMAIN_ORDER.indexOf(a.domain);
  const rb = BLOCKING_DATA_GAP_DOMAIN_ORDER.indexOf(b.domain);
  const diff = (ra === -1 ? 99 : ra) - (rb === -1 ? 99 : rb);
  if (diff !== 0) return diff;
  return a.key.localeCompare(b.key);
}

function compareNonBlockingDataGap(a: ImprovementCandidate, b: ImprovementCandidate): number {
  const diff = DOMAIN_ORDER.indexOf(a.domain) - DOMAIN_ORDER.indexOf(b.domain);
  if (diff !== 0) return diff;
  return a.key.localeCompare(b.key);
}

/**
 * Step3: 優先順位を確定する。
 * 順序: (1)重大リスクエスカレーション(4分類の優先順位→severity→confidence→20点スコア)
 *      (2)診断・予約計測を阻害するdata_gap
 *      (3)通常の20点ランキング(standard)
 *      (4)阻害しないdata_gap(確認推奨リストの末尾。TOP3に競合させない)
 */
export function rankImprovementCandidates(scored: ImprovementCandidate[]): ImprovementCandidate[] {
  const escalations = scored.filter((c) => c.kind === "risk_escalation").sort(compareEscalation);
  const blockingGaps = scored.filter((c) => c.kind === "data_gap" && c.dataGap!.blocking).sort(compareBlockingDataGap);
  const standard = scored.filter((c) => c.kind === "standard").sort(compareStandard);
  const nonBlockingGaps = scored
    .filter((c) => c.kind === "data_gap" && !c.dataGap!.blocking)
    .sort(compareNonBlockingDataGap);
  return [...escalations, ...blockingGaps, ...standard, ...nonBlockingGaps];
}

/** Step4: 既存契約(RunFreeDiagnosisResult.topImprovements)向けにTOP3のみ返す。 */
export function selectTopImprovements(ranked: ImprovementCandidate[]): ImprovementCandidate[] {
  return ranked.slice(0, 3);
}

/** サービス層向けの一括実行ヘルパー。内部では45項目すべての候補生成・採点・順位付けを行う。 */
export function buildTopImprovements(input: GenerateCandidatesInput): ImprovementCandidate[] {
  const drafts = generateImprovementCandidates(input);
  const scored = scoreImprovementCandidates(drafts);
  const deduped = deduplicateByRootCause(scored);
  const ranked = rankImprovementCandidates(deduped);
  return selectTopImprovements(ranked);
}
