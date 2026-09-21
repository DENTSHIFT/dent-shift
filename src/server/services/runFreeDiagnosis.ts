import { calculateDomainScore, calculateScoreBreakdown } from "@/domain/diagnosis/scoring";
import { DOMAIN_ORDER } from "@/domain/diagnosis/scoreCriteria";
import type { DiagnosisScoreBreakdown, DomainScore } from "@/domain/diagnosis/types";
import type {
  AioLossRootCauseSummary,
  CompetitorClinic,
  PatientQuestionResult,
} from "@/domain/competitor/types";
import {
  attributeQuestionLoss,
  aggregateAioLossRootCauses,
  NOT_APPLICABLE_LOSS_ATTRIBUTION,
} from "@/domain/competitor/aioLossAttribution";
import type {
  LossAttributionFields,
  LossAttributionObservationInput,
} from "@/domain/competitor/aioLossAttribution";
import type { ImprovementCandidate } from "@/domain/improvement-task/types";
import { buildTopImprovements } from "@/domain/improvement-task/priorityScoring";
import { buildAdComplianceResult } from "@/domain/ad-compliance/buildAdComplianceResult";
import type { AdComplianceCheckResult } from "@/domain/ad-compliance/types";
import type { AiObservationResult, AiProvider } from "@/server/providers/ai/types";
import type { CompetitorProvider } from "@/server/providers/competitor/types";
import type { ScoreCriterionInput, ScoreProvider } from "@/server/providers/scoring/types";
import type { AdComplianceProvider } from "@/server/providers/ad-compliance/types";
import type { AiMeasurementObservation } from "@/domain/ai-measurement/types";
import type { AiMeasurementProvider } from "@/domain/ai-measurement/provider";
import { MEASUREMENT_PLAN, findMeasurementPlanEntry } from "@/domain/ai-measurement/measurementPlan";
import { computeMeasurementCoverage } from "@/domain/ai-measurement/measurementCoverage";
import type { MeasurementCoverage } from "@/domain/ai-measurement/measurementCoverage";
import { computeCanonicalQuestionStatus } from "@/domain/ai-measurement/canonicalQuestionStatus";
import { buildDataDisclaimer } from "@/domain/diagnosis/dataDisclaimer";
import { isValidClinicContactPhone } from "@/domain/clinic/contactPhone";

export interface RunFreeDiagnosisInput {
  clinicName: string;
  directorName: string;
  clinicUrl: string;
  contactEmail: string;
  // 2026-09-21のユーザー指示: SMS認証に使うため必須のまま維持する
  // (「営業電話は一切行わない」旨をUI側で明示することを条件とする)。
  contactPhone: string;
  gbpUrl?: string;
  bookingUrl?: string;
}

export interface RunFreeDiagnosisResult {
  clinicName: string;
  clinicUrl: string;
  scoreBreakdown: DiagnosisScoreBreakdown;
  competitors: CompetitorClinic[];
  questionResults: PatientQuestionResult[];
  /**
   * 「なぜ負けている?」root cause TOP3(2026-09-06のユーザー指示)。questionResults
   * (質問単位のattributionを含む)から都度集約する(集約結果自体は永続化しない)。改善
   * TOP3(improvement-level)とは責務が分離している。
   * (なぜ負けている?=explanatory diagnosis / improvement TOP3=action prioritization)。
   * 十分な根拠を持つroot causeが3件未満の場合、無理に3件へ埋めない。
   */
  aioLossRootCauses: AioLossRootCauseSummary[];
  topImprovements: ImprovementCandidate[];
  // 医療広告AIチェック(正本§13)の結果。severity/confidenceにかかわらずすべての所見を含む
  // (改善TOP3に合流するのはescalationEligible=trueの所見のみ。2026-09-05のユーザー指示)
  adComplianceChecks: AdComplianceCheckResult;
  /**
   * AI別・質問別の生観測結果(2026-09-05のユーザー指示①: 「どのAIに・どの質問を投げ・
   * 自院/競合がどう表示されたか」を後から説明・再現できるように保持する)。
   * questionResultsはこれを質問単位に集約した表示用の結果であり、こちらはその根拠。
   * DiagnosisRepository.saveDiagnosisResult()がai_observationsテーブルへ保存する。
   */
  aiObservations: AiObservationResult[];
  /**
   * canonical AI計測観測結果(2026-09-07のユーザー指示: 「APIなしのcanonical persistence
   * bridge」)。deps.aiMeasurementProviderが指定された場合のみ設定される(未指定時は
   * undefinedのまま)。保存専用の並行データ。scoreBreakdown/aioLossRootCausesの算出には
   * 使わない(引き続き既存のaiObservations(legacy)だけを見る)。questionResultsについては、
   * 2026-09-07のユーザー指示(win/close/loseへのcanonical measurement本接続ラウンド)により、
   * この質問がMEASUREMENT_PLAN上で計測対象の場合のみそのstatus判定に使われる
   * (buildQuestionResults()のuseCanonicalStatus分岐を参照。計測対象外の質問・
   * aiMeasurementProvider未指定時は引き続き既存のaiObservations(legacy)だけで判定する)。
   */
  aiMeasurementObservations?: AiMeasurementObservation[];
  /**
   * この診断結果にmock/サンプルデータが1件でも含まれるか(2026-09-05のユーザー指示。
   * docs/DATA_MODEL.md正本の diagnoses.is_sample に対応)。computeIsSample()で
   * criterion/ai_observation/ad-compliance findingのdataSource・sourceTypeから
   * 機械的に算出する(このサービス層自身が"mock"を直接assertすることはない)。
   */
  isSample: boolean;
  // 引き継ぎ書3章-12: 推定/サンプルであることを常に明示する
  dataDisclaimer: string;
  measuredAt: string;
}

/**
 * この診断結果にmock/サンプルデータが1件でも含まれるかを機械的に判定する(2026-09-05の
 * ユーザー指示)。criterion単位のdataSource、ai_observationのdataSource、
 * ad-compliance findingのsourceTypeのいずれかに"mock"が含まれていればtrue。
 * 「実測に見せかけたサンプル診断」をDBレベルでも判別できるようにするための、
 * 独立してunit test可能な純粋関数(isEscalationEligibleと同じ設計方針)。
 */
export function computeIsSample(
  scoreBreakdown: DiagnosisScoreBreakdown,
  aiObservations: AiObservationResult[],
  adComplianceChecks: AdComplianceCheckResult
): boolean {
  const hasMockCriterion = scoreBreakdown.domains.some((domain) =>
    domain.criteria.some((criterion) => criterion.dataSource === "mock")
  );
  const hasMockAiObservation = aiObservations.some((obs) => obs.dataSource === "mock");
  const hasMockAdComplianceFinding = adComplianceChecks.findings.some(
    (finding) => finding.sourceType === "mock"
  );
  return hasMockCriterion || hasMockAiObservation || hasMockAdComplianceFinding;
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
  scoreProvider: ScoreProvider;
  adComplianceProvider: AdComplianceProvider;
  /**
   * canonical AI計測provider(任意、2026-09-07のユーザー指示: 「APIなしのcanonical
   * persistence bridge」、および同日のwin/close/lose本接続ラウンド)。未指定の場合、
   * 既存mock診断の挙動(スコアリング・勝敗判定・root cause判定・保存件数を含む)は完全に
   * 変わらない。指定された場合、aiMeasurementObservationsを追加で取得し、
   * MEASUREMENT_PLAN上で計測対象の質問についてはそのwin/close/lose判定にも使う
   * (scoreBreakdown/aioLossRootCausesには引き続き一切渡さない)。
   */
  aiMeasurementProvider?: AiMeasurementProvider;
}

export class InvalidDiagnosisInputError extends Error {}

function validateInput(input: RunFreeDiagnosisInput) {
  if (!input.clinicName?.trim()) {
    throw new InvalidDiagnosisInputError("医院名は必須です");
  }
  if (!input.directorName?.trim()) {
    throw new InvalidDiagnosisInputError("院長名は必須です");
  }
  if (!input.clinicUrl?.trim() || !/^https?:\/\//.test(input.clinicUrl.trim())) {
    throw new InvalidDiagnosisInputError("公式サイトURLは http(s):// から始まる形式で入力してください");
  }
  if (!input.contactEmail?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.contactEmail.trim())) {
    throw new InvalidDiagnosisInputError("メールアドレスの形式が正しくありません");
  }
  // SMS認証に使うため電話番号は必須(2026-09-21のユーザー指示)。
  if (!isValidClinicContactPhone(input.contactPhone ?? "")) {
    throw new InvalidDiagnosisInputError("電話番号は国内の10〜11桁で入力してください");
  }
}

/**
 * 無料60秒AI集患診断のユースケース(引き継ぎ書 Step3 / IMPLEMENTATION_PLAN.md Step3)。
 * このサービス層が「絶対に変えてはいけない事業ルール」を強制する場所になる:
 * - 取得不能なdomain/criterionを0点として扱わない
 * - 実測・参考・取得不能の状態を誤認させないdisclaimerを付与する
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

  // 2026-09-07のユーザー指示: 「APIなしのcanonical persistence bridge」。
  // deps.aiMeasurementProviderが指定された場合のみ、canonical観測を追加で取得する。
  // 2026-09-07のユーザー指示(win/close/loseへのcanonical measurement本接続ラウンド)により、
  // aiMeasurementObservationsはbuildQuestionResults()へ渡され、この質問がMEASUREMENT_PLAN上で
  // 計測対象の場合のみそのstatus(win/close/lose/insufficient_data)判定に使われるようになった
  // (buildQuestionResults内のuseCanonicalStatus分岐を参照)。scoring(buildScoreBreakdown)・
  // root cause集約(aggregateAioLossRootCauses)には引き続き一切渡さない(この2つは今回も対象外)。
  const aiMeasurementObservations = deps.aiMeasurementProvider
    ? await deps.aiMeasurementProvider.observe({
        clinicName: input.clinicName,
        clinicUrl: input.clinicUrl,
        patientQuestions: PATIENT_QUESTIONS,
        competitors,
      })
    : undefined;

  const scoreBreakdown = await buildScoreBreakdown(input, aiObservations, deps.scoreProvider);
  const questionResults = buildQuestionResults(
    PATIENT_QUESTIONS,
    aiObservations,
    aiMeasurementObservations
  );

  // 医療広告AIチェック(正本§13)。P0では実本文取得の仕組みがまだないため、
  // reviewResponseTextsは常に空配列で呼び出す(将来、口コミ返信文が取得可能になった時点で接続する)。
  // domain層(buildAdComplianceResult)がconfidence導出・PIIマスキング・重複整理・disclaimer付与を行う。
  const rawAdRiskFindings = await deps.adComplianceProvider.check({
    clinicName: input.clinicName,
    clinicUrl: input.clinicUrl,
    reviewResponseTexts: [],
  });
  const adComplianceChecks = buildAdComplianceResult(rawAdRiskFindings, new Date().toISOString());

  // 改善TOP3生成ロジック本体はdomain/improvement-task/priorityScoring.tsに分離済み
  // (2026-09-05: 正本§1.2/§8の4軸20点式+自動エスカレーションに置き換え。
  //  同日: 医療広告AIチェックのescalationEligible所見をlegal_medical_ad_privacyへ合流)
  const topImprovements = buildTopImprovements({
    breakdown: scoreBreakdown,
    questionResults,
    adComplianceFindings: adComplianceChecks.findings,
  });

  const isSample = computeIsSample(scoreBreakdown, aiObservations, adComplianceChecks);
  // 「なぜ負けている?」root cause TOP3。questionResults(質問単位のattributionを含む)
  // から都度集約する(2026-09-06のユーザー指示: 集約結果自体は永続化しない)。
  const aioLossRootCauses = aggregateAioLossRootCauses(questionResults);

  return {
    clinicName: input.clinicName,
    clinicUrl: input.clinicUrl,
    scoreBreakdown,
    competitors,
    questionResults,
    aioLossRootCauses,
    topImprovements,
    adComplianceChecks,
    aiObservations,
    aiMeasurementObservations,
    isSample,
    dataDisclaimer: buildDataDisclaimer(isSample, aiMeasurementObservations),
    measuredAt: new Date().toISOString(),
  };
}

/**
 * 6領域それぞれをScoreProviderへ委譲し(取得データ→判定ルール→criterion score)、
 * domain層の集計関数(calculateDomainScore/calculateScoreBreakdown)で正本の配点ルールに沿って集計する。
 * このサービス層・domain層には乱数やmock固有の分岐を一切持ち込まない(provider実装のみの責務)。
 *
 * 【2026-09-08のユーザー指示: AIO scoring接続ラウンド(案B、measurement overlayのみ)】
 * この関数は意図的にaiMeasurementObservations(canonical)を一切受け取らない・渡さない
 * (引数はlegacyのaiObservationsのみ)。canonical measuredとlegacy referenceを1つのAIO30点
 * scoreへ混ぜないための確定方針であり、P0では既存AIO30点をreference/mockベースのまま維持する。
 * canonicalの実測価値はscoreBreakdownではなくquestionResults側(status/statusSource/
 * measurementCoverage/canonical root cause)でのみ提供する。この非接続はtests/unit/
 * runFreeDiagnosisCanonicalScoringIsolation.test.tsで回帰確認している。将来canonical measured
 * scoreを正式導入する場合(案A方向)も、この関数のシグネチャ・呼び出し元(buildScoreBreakdown
 * 呼び出し部)を安易に拡張せず、別途スコープされた設計変更として扱うこと。
 */
async function buildScoreBreakdown(
  input: RunFreeDiagnosisInput,
  aiObservations: AiObservationResult[],
  scoreProvider: ScoreProvider
): Promise<DiagnosisScoreBreakdown> {
  const scoreInput: ScoreCriterionInput = {
    clinicName: input.clinicName,
    clinicUrl: input.clinicUrl,
    gbpUrl: input.gbpUrl,
    bookingUrl: input.bookingUrl,
    aiObservations,
  };

  const domainScores: DomainScore[] = await Promise.all(
    DOMAIN_ORDER.map(async (domain) => {
      const criteria = await scoreProvider.score(domain, scoreInput);
      return calculateDomainScore(domain, criteria);
    })
  );

  return calculateScoreBreakdown(domainScores);
}

/**
 * 質問一覧(questions)を正とし、観測結果(aiObservations)から質問ごとに集計する。
 * 2026-09-05修正: 従来はaiObservationsに含まれるquestionのみをキー化していたため、
 * 特定の質問で観測結果が0件(AIプロバイダーが応答しなかった等)の場合、その質問自体が
 * 結果から消えてしまい"insufficient_data"を返すことができなかった(未使用のstatusのまま)。
 * questionsを起点にすることで、観測0件の質問も確実に"insufficient_data"として返す。
 * 「聞かれていない」ことと「聞かれたが選ばれなかった」ことを混同しない
 * (引き継ぎ書8.3章: 断定表現を避ける方針)。
 */
function buildQuestionResults(
  questions: string[],
  aiObservations: AiObservationResult[],
  aiMeasurementObservations: AiMeasurementObservation[] | undefined
): PatientQuestionResult[] {
  const byQuestion = new Map<string, AiObservationResult[]>();
  for (const question of questions) {
    byQuestion.set(question, []);
  }
  for (const obs of aiObservations) {
    const list = byQuestion.get(obs.question) ?? [];
    list.push(obs);
    byQuestion.set(obs.question, list);
  }

  return questions.map((question) => {
    const observations = byQuestion.get(question) ?? [];
    const measurementCoverage = buildMeasurementCoverageForQuestion(
      question,
      aiMeasurementObservations
    );

    // win/close/loseへのcanonical measurement本接続(2026-09-07のユーザー指示)。
    // この質問がMEASUREMENT_PLAN上で計測対象(totalProviders > 0)であり、かつこのrunで
    // canonical provider(aiMeasurementProvider)が指定されている場合のみcanonical観測で
    // 判定する。それ以外(canonical provider未指定 / この質問がplan対象外)は、従来どおり
    // legacy mock観測(aiObservations)で判定する。canonicalとlegacyを1質問のwin/close/lose
    // 判定内で混在させない(ユーザー指示のF: 非混在保証)。
    const useCanonicalStatus =
      measurementCoverage !== null && measurementCoverage.totalProviders > 0;

    let status: PatientQuestionResult["status"];
    let evidence: string[];
    let statusSource: PatientQuestionResult["statusSource"];

    // measurementStatus==="measured"の観測のみを判定対象にする(reference/unavailableは
    // win/close/loseにもroot causeにも一切混ぜない。ユーザー指示のルール: measuredProviders
    // ===0の場合はlegacyへfallbackせず無条件でinsufficient_dataとする。この無条件fallback
    // 禁止はcomputeCanonicalQuestionStatus内で保証される(observations.length===0の分岐))。
    // 2026-09-08のユーザー指示: root cause本接続でも、status判定に実際に使用したのと
    // 同じmeasuredCanonicalObservationsをそのままroot cause入力に渡す(root cause側で
    // provider間のwin/loseを再決定しない。ここはouter scopeで一度だけ計算し、
    // status/evidence/root causeの3箇所で同じ配列を再利用する)。
    const measuredCanonicalObservations = (aiMeasurementObservations ?? []).filter(
      (obs) => obs.question === question && obs.measurementStatus === "measured"
    );

    if (useCanonicalStatus) {
      status = computeCanonicalQuestionStatus(measuredCanonicalObservations);
      evidence = measuredCanonicalObservations.map(
        (o) => `[${o.providerId}] ${o.evidence}`
      );
      // statusSourceはstatus値そのものとは直交する(2026-09-07のユーザー指示訂正)。
      // measuredProviders===0でstatus==="insufficient_data"になった場合も、判定を
      // 行った系統はcanonicalであるため"canonical_measurement"のままとする。
      statusSource = "canonical_measurement";
    } else {
      if (observations.length === 0) {
        status = "insufficient_data";
      } else {
        const mentionedCount = observations.filter((o) => o.mentioned).length;
        const bestRank = Math.min(
          ...observations.map((o) => o.recommendationRank ?? Infinity)
        );
        if (mentionedCount === 0) status = "lose";
        else if (mentionedCount === observations.length && bestRank <= 1) status = "win";
        else status = "close";
      }
      evidence = observations.map((o) => `[${o.aiProvider}] ${o.evidence}`);
      statusSource = "legacy_reference";
    }

    // 「なぜ負けている?」root cause属性(2026-09-06のユーザー指示、2026-09-08のcanonical
    // measured lose本接続で更新)。status==="lose"の質問のみ、その質問の判定に実際に
    // 使った証拠(useCanonicalStatusならmeasuredCanonicalObservations、そうでなければ
    // legacyのobservations)だけからevidence-first attributionを行う。win/close/
    // insufficient_dataはnot_applicableのまま(不変)。
    // canonical/legacyを1質問のroot cause内で混在させない(ユーザー指示のH: 非混在保証)。
    // useCanonicalStatusという、status判定と同一の分岐フラグをそのまま使うことで、
    // 「どちらの経路でstatusを決めたか」と「どちらの経路でroot causeを決めるか」が
    // 構造的にずれないようにする。
    let lossAttribution: LossAttributionFields;
    if (status !== "lose") {
      lossAttribution = NOT_APPLICABLE_LOSS_ATTRIBUTION;
    } else if (useCanonicalStatus) {
      lossAttribution = attributeQuestionLoss(
        measuredCanonicalObservations.map(mapCanonicalMeasuredForLossAttribution)
      );
    } else {
      lossAttribution = attributeQuestionLoss(observations.map(mapLegacyForLossAttribution));
    }

    return {
      question,
      status,
      // status === "insufficient_data" のときのみ "insufficient_data"(2026-09-06のユーザー指示④)
      unavailableReason: status === "insufficient_data" ? "insufficient_data" : null,
      evidence,
      ...lossAttribution,
      measurementCoverage,
      statusSource,
    };
  });
}

/**
 * 1質問分のmeasurementCoverageを算出する(2026-09-07のユーザー指示: measurementCoverage
 * の「加算的接続」ラウンド)。この関数自体はtotalProviders/measuredProviders等の数値を
 * 集計するだけの独立した計算であり、buildQuestionResults()内のstatus算出ロジックとは
 * 別関数に分離する。
 * 2026-09-07の後続ラウンド(win/close/lose本接続)注記: この関数が返すMeasurementCoverage
 * (特にtotalProviders > 0か否か)は、buildQuestionResults()がcanonical/legacyどちらの
 * 経路で当該質問のstatusを判定するかの分岐条件として使われるようになった。ただし、
 * この関数自身はその分岐判断を行わず、あくまで数値の算出のみを担う。
 */
function buildMeasurementCoverageForQuestion(
  question: string,
  aiMeasurementObservations: AiMeasurementObservation[] | undefined
): MeasurementCoverage | null {
  // このrunでcanonical provider(deps.aiMeasurementProvider)が指定されなかった場合、
  // 既存mock診断との後方互換を優先してnullとする(2026-09-07のユーザー指示)。
  if (aiMeasurementObservations === undefined) {
    return null;
  }

  // PATIENT_QUESTIONSの各質問はMEASUREMENT_PLANに対応entryを必ず持つべきであり、
  // planと質問定義のdriftをsilent nullにせず早期検出する(2026-09-07のユーザー指示)。
  const planEntry = findMeasurementPlanEntry(MEASUREMENT_PLAN, question);

  const observationsForQuestion = aiMeasurementObservations.filter(
    (obs) => obs.question === question
  );

  // targetProviders=[]の質問は、computeMeasurementCoverage()が全項目0・isPartial=falseを
  // 返す(この質問が「今回計測対象外」であることを明示的な値として表現する。nullにはしない)。
  // targetProviders.length > 0 なのに対応するobservationが欠落/重複している場合は、
  // computeMeasurementCoverage()がMeasurementPlanExecutionMismatchErrorをthrowする
  // (unavailableへの推測変換はしない)。
  return computeMeasurementCoverage(planEntry, observationsForQuestion);
}

/**
 * legacy AiObservationResultを、root cause attribution engine(attributeQuestionLoss)
 * が要求するLossAttributionObservationInputへ変換する(2026-09-08のユーザー指示: canonical
 * measured loseのroot cause本接続ラウンド)。
 *
 * legacy側のdataSource==="live"は、実providerが実装されたことがなく実DBにも1件も存在
 * しない(2026-09-08の実装時確認で、実DB/production composition rootのいずれにも
 * "live"は存在しないことを確認済み)。仮に将来何らかの理由でdataSource==="live"の
 * 観測が新しいrunFreeDiagnosis()呼び出しに紛れ込んだ場合、canonicalの"canonical_
 * measurement"へ推測変換することは禁止されているため(canonical→legacy "live"の
 * 逆方向と同じ理由で、legacy live→canonical語彙への横滑りも行わない)、この関数は
 * 新規runの入力契約違反として明示的にthrowする。
 *
 * 注意: このthrowは「新しい観測を変換しようとした時」にのみ発生する。既に永続化済みの
 * questionResultsJson(PatientQuestionResult.sourceType)を読み出す経路はこの関数を
 * 一切通らないため、過去診断の閲覧がこのthrowによって壊れることはない。
 */
export class UnsupportedLegacyLiveObservationForLossAttributionError extends Error {}

export function mapLegacyForLossAttribution(
  obs: AiObservationResult
): LossAttributionObservationInput {
  if (obs.dataSource !== "mock") {
    throw new UnsupportedLegacyLiveObservationForLossAttributionError(
      `dataSource='${obs.dataSource}' cannot be mapped for root cause attribution ` +
        `(legacy live→canonical vocabulary conversion is not supported; only dataSource='mock' is)`
    );
  }
  return {
    mentioned: obs.mentioned,
    competitorMentions: obs.competitorMentions,
    sourceType: "mock",
  };
}

/**
 * canonical measured観測(measurementStatus==="measured")を、root cause attribution
 * engineが要求するLossAttributionObservationInputへ変換する(2026-09-08のユーザー指示)。
 *
 * measurementStatus!=="measured"の観測(reference/unavailable)を渡すことは呼び出し契約
 * 違反であり、黙って除外・変換せず明示的にthrowする(reference/unavailableをreal root
 * cause attributionへ混ぜないというユーザー指示のルール3を、この関数の入口で機械的に
 * 保証する)。呼び出し側(buildQuestionResults)は既にmeasuredのみへフィルタ済みの配列を
 * 渡すため、通常この分岐へは到達しない。
 *
 * 現在のroot cause engineが必要とする最小情報(mentioned/competitorMentions)だけを
 * 変換する。citations/recommendationRank/measurementMeta等、engineが使わない
 * canonical fieldはここへコピーしない(不要なcanonical fieldをlegacy形状へ大量コピー
 * しない、というユーザー指示に従う)。
 */
export class UnsupportedNonMeasuredCanonicalObservationForLossAttributionError extends Error {}

export function mapCanonicalMeasuredForLossAttribution(
  obs: AiMeasurementObservation
): LossAttributionObservationInput {
  if (obs.measurementStatus !== "measured") {
    throw new UnsupportedNonMeasuredCanonicalObservationForLossAttributionError(
      `measurementStatus='${obs.measurementStatus}' cannot be used as real root cause ` +
        `attribution evidence (only measurementStatus='measured' is supported)`
    );
  }
  // measurementStatus==="measured"の観測はdomain invariant
  // (src/domain/ai-measurement/invariants.ts)によりmentioned/competitorMentionsが
  // 必ず非nullであることが期待されるが、そのinvariant検証(validateAiMeasurementObservation)
  // は永続化直前(diagnosisRepository.saveDiagnosisResult)で行われるものであり、この時点
  // (root cause判定時点)ではまだ検証されていない。値が欠けている場合にfalse/[]へ黙って
  // 補正すると「原因を捏造しない」という一貫方針に反するため、ここでも明示的にthrowする。
  if (obs.mentioned === null || obs.competitorMentions === null) {
    throw new UnsupportedNonMeasuredCanonicalObservationForLossAttributionError(
      `measurementStatus='measured' observation is missing mentioned/competitorMentions ` +
        `(invariant violation; this should have been rejected earlier by ` +
        `validateAiMeasurementObservation)`
    );
  }
  return {
    mentioned: obs.mentioned,
    competitorMentions: obs.competitorMentions,
    sourceType: "canonical_measurement",
  };
}
