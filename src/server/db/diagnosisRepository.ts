import { prisma } from "./prismaClient";
import type { RunFreeDiagnosisResult } from "@/server/services/runFreeDiagnosis";
import type { AdComplianceCheckResult } from "@/domain/ad-compliance/types";
import { validateAiMeasurementObservation } from "@/domain/ai-measurement/invariants";
import { resolveObservationProvisional } from "@/domain/ai-measurement/observationProvisional";
import {
  normalizeResultEmailDeliveryStatus,
  type ResultEmailDeliveryStatus,
} from "@/domain/email/resultEmailDeliveryStatus";

/**
 * saveDiagnosisResult/getDiagnosisById(結果ページ用)は無料診断のUX上、認証なしで
 * 呼び出せる(IDを知っていれば見られる)。一方 getDiagnosesByClinicId は Step4 で追加した
 * clinicId必須のテナント境界付きクエリで、ダッシュボードなど認証済み画面専用に使う
 * (SECURITY.md 2章「テナント分離の実装方針」)。
 *
 * 2026-09-05: 無料診断結果への正式統合により、以下を追加で永続化する。
 * - adComplianceChecksJson / isSample (Diagnosis)
 * - ai_observations(AI別・質問別の生観測結果。独立テーブル。ユーザー指示①)
 * 追加のevidence/measurement metadataは保存するが、患者個人情報は一切含めない
 * (質問文・医院側の観測結果のみ)。無制限な生レスポンス保存も行わない
 * (evidenceは要約済み文字列のみ)。
 */
/**
 * 2026-09-07のユーザー指示(Phase 2: measurementStatus NOT NULL化の前提整理)。
 * 新規AiObservation書き込み時のmeasurementStatus決定をこの1関数へ集約する。
 * - dataSource==="mock" → "reference"(確定。mock providerの観測は常にreference)。
 * - dataSource==="live" → 実provider(OpenAiProvider/GeminiProvider)は未実装で、
 *   DBにもsourceType="live"の行は現時点で0件。「NOT NULL化のためだけにlive=measuredと
 *   誤認するロジックを作らない」というユーザー指示により、"measured"へ推測変換せず、
 *   明示的にLegacyLiveAiObservationErrorをthrowする(実provider実装時に、実際の
 *   search実行有無からmeasurementStatusを明示的に設定するコードへ置き換える)。
 * 戻り値の型をstring(non-nullable)にすることで、measurementStatus=nullを書き込む
 * 経路が型レベルで存在しないことを保証する(呼び出し側でnullへfallbackさせない限り)。
 */
export class LegacyLiveAiObservationError extends Error {}

/**
 * ログイン中の再診断で、セッションに紐づくClinicが見つからない場合の整合性エラー。
 * 呼び出し側が任意のclinicIdを渡す用途ではなく、サーバー側で解決したclinicIdだけを
 * saveDiagnosisResult()へ渡すことを前提とする。
 */
export class ExistingClinicNotFoundError extends Error {}

export function resolveMeasurementStatusForNewObservation(
  dataSource: "mock" | "live"
): string {
  if (dataSource === "mock") {
    return "reference";
  }
  throw new LegacyLiveAiObservationError(
    "Legacy live AiObservation cannot be persisted without explicit measurementStatus"
  );
}

export async function saveDiagnosisResult(
  input: {
    clinicUrl: string;
    directorName: string;
    contactEmail: string;
    contactPhone?: string;
    gbpUrl?: string;
    bookingUrl?: string;
    existingClinicId?: string;
  },
  result: RunFreeDiagnosisResult
) {
  // 2026-09-07のユーザー指示: measurementStatusの決定(=legacy live観測の拒否判定)は、
  // どのDB書き込みよりも前に行う。resolveMeasurementStatusForNewObservation()が
  // throwした場合、この関数はclinic/diagnosisのいずれもDBへ書き込んでいない状態を
  // 保証する(「DBへ保存しない」という指示を、orphanなclinic行を残さない形で満たす)。
  const validatedAiObservations = result.aiObservations.map((obs) => ({
    patientQuestion: obs.question,
    provider: obs.aiProvider,
    model: obs.model,
    mention: obs.mentioned,
    rank: obs.recommendationRank,
    citationsJson: JSON.stringify(obs.citations),
    competitorsJson: JSON.stringify(obs.competitorMentions),
    region: obs.region,
    capturedAt: new Date(obs.capturedAt),
    evidence: obs.evidence,
    // sourceType/provisionalはAiObservationResult.dataSourceから機械的に導出する
    // (provider/呼び出し側が直接assertしない。ad-compliance findingと同じ原則)。
    sourceType: obs.dataSource,
    provisional: obs.dataSource === "mock",
    measurementStatus: resolveMeasurementStatusForNewObservation(obs.dataSource),
    // mock観測は失敗ではないため常にnull。unavailableは現時点では発生しない
    // (buildQuestionResults()側が観測0件をinsufficient_dataとして扱う既存経路のみ)。
    unavailableReason: null,
    // mock観測にはtool種別・searchクエリ等のmeasurement metadataが存在しないためnull
    // (sourceType="ai_provider"の観測にのみ、実provider実装時にmeasurementMetaJsonを
    // 必須で設定する。docs/AI_MEASUREMENT_PROVIDER_DESIGN_2026-09-07.md参照)。
    measurementMetaJson: null,
  }));

  // 2026-09-07のユーザー指示(「APIなしのcanonical persistence bridge」): canonical観測
  // (result.aiMeasurementObservations)は、legacy観測と同様にどのDB書き込みよりも前に
  // 検証する。validateAiMeasurementObservation()がinvariant違反をthrowした場合、この
  // 関数はclinic/diagnosisのいずれもDBへ書き込んでいない状態を保証する(orphanなclinic
  // 行を残さない)。measurementStatusはここでも一切推測しない(obsの値をそのまま使う。
  // legacy専用のresolveMeasurementStatusForNewObservation()はcanonical観測には使わない)。
  // provisionalはobs.provisionalを信用せず、resolveObservationProvisional()で独立に
  // 再計算する(両者が一致することはvalidateAiMeasurementObservation()内のdomain
  // invariantとしても保証されているため、ここでの再計算は二重の安全策)。
  const validatedAiMeasurementObservations = (result.aiMeasurementObservations ?? []).map(
    (obs) => {
      validateAiMeasurementObservation(obs);
      return {
        patientQuestion: obs.question,
        provider: obs.providerId,
        model: obs.model,
        mention: obs.mentioned,
        rank: obs.recommendationRank,
        citationsJson: obs.citations === null ? null : JSON.stringify(obs.citations),
        competitorsJson:
          obs.competitorMentions === null ? null : JSON.stringify(obs.competitorMentions),
        region: obs.region,
        capturedAt: new Date(obs.capturedAt),
        evidence: obs.evidence,
        sourceType: obs.sourceType,
        provisional: resolveObservationProvisional(obs.sourceType, obs.measurementStatus),
        measurementStatus: obs.measurementStatus,
        unavailableReason: obs.unavailableReason,
        measurementMetaJson:
          obs.measurementMeta === null ? null : JSON.stringify(obs.measurementMeta),
      };
    }
  );

  // 未ログインの無料診断は従来どおりClinicを新規作成する。ログイン中の再診断では、
  // API routeがセッションから解決したexistingClinicIdを渡し、同じClinicへ履歴を追加する。
  // clientのリクエストbodyからclinicIdを受け取らないことで、他院への書き込みを防ぐ。
  const clinic = input.existingClinicId
    ? await prisma.clinic.findUnique({ where: { id: input.existingClinicId } })
    : await prisma.clinic.create({
        data: {
          name: result.clinicName,
          directorName: input.directorName.trim(),
          url: input.clinicUrl,
          // 無料診断フォームのメールアドレスは医院の代表連絡先であり、患者情報ではない。
          // DATA_MODEL.mdのclinics.contact_emailに対応する。
          contactEmail: input.contactEmail.trim(),
          // 医院の代表電話。患者個人情報ではなく、無料診断の必須連絡先として保持する。
          contactPhone: input.contactPhone?.trim(),
          gbpUrl: input.gbpUrl,
          bookingUrl: input.bookingUrl,
        },
      });

  if (!clinic) {
    throw new ExistingClinicNotFoundError("Session clinic was not found");
  }

  // 電話番号必須化前に登録された医院は、最初の再診断時に今回の入力で補完する。
  if (input.existingClinicId && !clinic.contactPhone && input.contactPhone?.trim()) {
    await prisma.clinic.update({
      where: { id: clinic.id },
      data: { contactPhone: input.contactPhone.trim() },
    });
  }
  // 院長名必須化(Ver3.3)前に登録された医院も、同様に最初の再診断時に補完する。
  if (input.existingClinicId && !clinic.directorName && input.directorName.trim()) {
    await prisma.clinic.update({
      where: { id: clinic.id },
      data: { directorName: input.directorName.trim() },
    });
  }

  const measuredAt = new Date(result.measuredAt);

  const diagnosis = await prisma.diagnosis.create({
    data: {
      clinicId: clinic.id,
      totalPoints: result.scoreBreakdown.totalPoints,
      totalStatus: result.scoreBreakdown.totalStatus,
      scoreBreakdownJson: JSON.stringify(result.scoreBreakdown),
      competitorsJson: JSON.stringify(result.competitors),
      questionResultsJson: JSON.stringify(result.questionResults),
      improvementTasksJson: JSON.stringify(result.topImprovements),
      dataDisclaimer: result.dataDisclaimer,
      measuredAt,
      // AdComplianceCheckResultを丸ごと保存する(findings[].sourceType/provisional/
      // sourceLabel/severity/confidence/evidence/escalationEligibleを含め、
      // JSON.stringifyなので構造は一切欠落しない)。
      adComplianceChecksJson: JSON.stringify(result.adComplianceChecks),
      // isSampleはrunFreeDiagnosis.tsのcomputeIsSample()が機械的に算出した値をそのまま
      // 保存する(repositoryはpersistenceのみを担当し、判定ロジックは持たない)。
      isSample: result.isSample,
      aiObservations: {
        // legacy観測(mock)とcanonical観測(canonical bridge経由、任意)を同じテーブルへ
        // まとめて保存する(2026-09-07のユーザー指示: 両者は同じPrisma AiObservation行
        // shapeに収まるよう設計済みのため、追加のテーブル分割は不要)。
        create: [...validatedAiObservations, ...validatedAiMeasurementObservations].map(
          (obs) => ({
            // diagnosisId経由でも辿れるが、clinic単位のテナント分離クエリをJOINなしで
            // 行えるようにclinicIdを直接持たせる(ネスト作成では自動設定されないため明示する)。
            clinicId: clinic.id,
            measurementAt: measuredAt,
            ...obs,
          })
        ),
      },
    },
  });

  return { clinicId: clinic.id, diagnosisId: diagnosis.id };
}

/**
 * 診断保存後に行う結果メール送信の成否を、診断本体の成否と分離して記録する。
 * メール障害が起きても診断結果は失わず、結果画面で利用者へ正確な状態を案内する。
 */
export async function updateDiagnosisResultEmailStatus(
  diagnosisId: string,
  status: Exclude<ResultEmailDeliveryStatus, "pending">
) {
  return prisma.diagnosis.update({
    where: { id: diagnosisId },
    data: {
      resultEmailStatus: status,
      resultEmailSentAt: status === "sent" ? new Date() : null,
    },
    select: { resultEmailStatus: true, resultEmailSentAt: true },
  });
}

/**
 * DB上のAiObservation行を、表示・API向けの読みやすい形へ変換する。
 * 2026-09-07: mention/citationsJson/competitorsJsonがnullable化されたことに伴い、
 * このマッピング関数の境界でnullを吸収する(呼び出し元へnullをそのまま伝播させる)。
 * SQL NULL=未測定/unavailable、"[]"=測定して0件、JSON配列=測定して値あり、という
 * 区別を失わないよう、null時に空配列へフォールバックさせない
 * (docs/AI_MEASUREMENT_PROVIDER_DESIGN_2026-09-07.md参照)。
 * 現時点(P0 mock providerのみ)ではnullが実際に書き込まれることはないが、
 * 実providerのunavailable観測を今後扱えるよう型を先行して広げておく。
 */
function mapAiObservationRow(row: {
  patientQuestion: string;
  provider: string;
  model: string;
  mention: boolean | null;
  rank: number | null;
  citationsJson: string | null;
  competitorsJson: string | null;
  region: string | null;
  measurementAt: Date;
  capturedAt: Date;
  evidence: string;
  sourceType: string;
  measurementStatus: string | null;
  unavailableReason: string | null;
  measurementMetaJson: string | null;
  provisional: boolean;
}) {
  return {
    question: row.patientQuestion,
    aiProvider: row.provider,
    model: row.model,
    mentioned: row.mention,
    recommendationRank: row.rank,
    citations: row.citationsJson !== null ? (JSON.parse(row.citationsJson) as string[]) : null,
    competitorMentions:
      row.competitorsJson !== null ? (JSON.parse(row.competitorsJson) as string[]) : null,
    region: row.region,
    measurementAt: row.measurementAt,
    capturedAt: row.capturedAt,
    evidence: row.evidence,
    sourceType: row.sourceType,
    // 2026-09-07: Phase 1で追加した3列をそのまま読み出す(machine-readableなJSON文字列の
    // parseはここでは行わない。measurementMetaJsonの正式スキーマ解釈は実provider実装時に
    // 必要になった時点で追加する。現時点ではmock観測は常にnullのため何も失われない)。
    measurementStatus: row.measurementStatus,
    unavailableReason: row.unavailableReason,
    measurementMetaJson: row.measurementMetaJson,
    provisional: row.provisional,
  };
}

export async function getDiagnosisById(diagnosisId: string) {
  const diagnosis = await prisma.diagnosis.findUnique({
    where: { id: diagnosisId },
    include: { clinic: true, aiObservations: true },
  });
  if (!diagnosis) return null;

  return {
    clinicId: diagnosis.clinicId,
    clinicName: diagnosis.clinic.name,
    clinicUrl: diagnosis.clinic.url,
    totalPoints: diagnosis.totalPoints,
    totalStatus: diagnosis.totalStatus,
    scoreBreakdown: JSON.parse(diagnosis.scoreBreakdownJson),
    competitors: JSON.parse(diagnosis.competitorsJson),
    questionResults: JSON.parse(diagnosis.questionResultsJson),
    topImprovements: JSON.parse(diagnosis.improvementTasksJson),
    adComplianceChecks: JSON.parse(diagnosis.adComplianceChecksJson) as AdComplianceCheckResult,
    isSample: diagnosis.isSample,
    aiObservations: diagnosis.aiObservations.map(mapAiObservationRow),
    dataDisclaimer: diagnosis.dataDisclaimer,
    measuredAt: diagnosis.measuredAt,
    resultEmailStatus: normalizeResultEmailDeliveryStatus(diagnosis.resultEmailStatus),
    resultEmailSentAt: diagnosis.resultEmailSentAt,
  };
}

/**
 * Step4: 医院側ダッシュボード用。clinicIdでスコープし、他医院のデータが混ざらないようにする
 * (SECURITY.md「テナント分離の実装方針」)。isSampleを一覧に含めることで、JSON列を
 * 読み込まなくても「サンプル診断」を一覧上で判別できるようにする(2026-09-05のユーザー指示)。
 */
export async function getDiagnosesByClinicId(clinicId: string) {
  return prisma.diagnosis.findMany({
    where: { clinicId },
    orderBy: { measuredAt: "desc" },
    select: { id: true, totalPoints: true, totalStatus: true, measuredAt: true, isSample: true },
  });
}
