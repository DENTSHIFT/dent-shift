import type { AiProviderId } from "./types";

/**
 * 計測対象provider計画(2026-09-07のユーザー指示: measurement plan仕様確定ラウンド)。
 *
 * 重要: このファイルは現時点で完全に独立したdomain configである。production
 * composition root(src/app/api/diagnosis/route.ts)にもruntime service層
 * (src/server/services/runFreeDiagnosis.ts)にも一切接続されていない(接続は
 * ユーザーの明示的な指示があるまで行わない)。unit testで検証可能な、静的な設定値
 * としてのみ存在し、この定数の値を変更しても本番挙動には一切影響しない。
 */

/**
 * 1質問あたりの計測対象provider設定。
 * P0では質問文字列そのものをkeyとして使う(既存コード全体
 * (PatientQuestionResult.question / AiObservationResult.question / AiMeasurementObservation.question)
 * が一貫して質問文字列をキーにしているため、別途keyを導入しない)。
 */
export interface MeasurementPlanQuestionEntry {
  question: string;
  /**
   * この質問で「今回計測対象として選ばれた」provider(「システムが対応可能な
   * provider数」ではない)。2026-09-07のユーザー指示: 未実装providerを常に
   * unavailableとして分母に入れる設計にはしない。空配列は「この質問は今回計測
   * 対象に含めない(未計測)」ことを明示する、正当な状態として許可する。
   */
  targetProviders: AiProviderId[];
}

export interface MeasurementPlan {
  planVersion: string;
  questions: MeasurementPlanQuestionEntry[];
}

/**
 * measurement planのバージョンタグ。既存のAIO_LOSS_ATTRIBUTION_LOGIC_VERSION
 * ("aio-loss-attribution@2026-09-08.1")やOPENAI_MEASUREMENT_LOGIC_VERSIONと
 * 同じ命名規約(`<name>@<date>.<連番>`)に揃える。targetProvidersの構成を変更した
 * 場合は必ずこの値を更新すること(過去診断のmeasurementCoverageがどのplan設定に
 * 基づいて算出されたかを、この値を通じて追跡できるようにするため。2026-09-07の
 * ユーザー指示「H. planVersionが必要か」への回答に対応)。
 *
 * 2026-09-07: .1→.2へ更新(6問すべてOpenAI対象 → 質問1・3・5のみOpenAI対象へ
 * targetProviders構成を変更したため。まだproduction未接続の段階でも、
 * 「このversionがどのtargetProviders設定を表すか」を一意に識別できるようにする
 * ため、内容変更のたびにversionを更新する方針とする)。
 */
export const MEASUREMENT_PLAN_VERSION = "ai-measurement-plan@2026-09-07.2";

/**
 * P0の患者質問セット(src/server/services/runFreeDiagnosis.tsのPATIENT_QUESTIONSと
 * 同一文言)。今回はrunFreeDiagnosis.tsを変更しない制約があるため、意図的にこの
 * ファイル内へ複製している。将来この計画を実際に接続するラウンドで、どちらか一方
 * (このファイル、またはrunFreeDiagnosis.ts)を正としてexport/importし直す必要が
 * あり、この複製は暫定的なものである(最終報告I「変更ファイル一覧」に明記する)。
 */
const PATIENT_QUESTIONS: readonly string[] = [
  "駅から近いおすすめの歯医者は?",
  "痛みが少ないインプラント治療ができる歯科医院は?",
  "土日も診療している歯科医院は?",
  "子供を連れて行きやすい小児歯科は?",
  "評判の良い歯科医院を教えて",
  "ホワイトニングの料金が分かりやすい歯科医院は?",
];

/**
 * P0で実測対象とする質問(2026-09-07のユーザー指示: MEASUREMENT_PLAN初期内容の修正
 * ラウンド)。docs/AI_MEASUREMENT_PROVIDER_DESIGN_2026-09-07.md 16章「6問のうち
 * 中心的な2〜3問のみを実測対象とする」方針に基づく。同文書には対象質問の具体名は
 * 明記されていなかったため、候補を提示しユーザーが選定した3問(駅から近い/
 * 土日診療/評判)を採用する。provider実装(OpenAiProvider等)自体は6問すべてに
 * 対応可能である(9章)ことと、この診断runでどの質問を実測対象とするかは別概念
 * であり、MEASUREMENT_PLANは後者だけを表す。
 */
const AI_MEASUREMENT_TARGET_QUESTIONS: ReadonlySet<string> = new Set([
  "駅から近いおすすめの歯医者は?",
  "土日も診療している歯科医院は?",
  "評判の良い歯科医院を教えて",
]);

/**
 * P0初期内容: 実OpenAI API接続・Gemini実装のいずれも未着手のため、この定数の値を
 * 変更しても本番挙動には一切影響しない。AI_MEASUREMENT_TARGET_QUESTIONSに含まれる
 * 質問のみtargetProviders=["openai"]とし、残りはtargetProviders=[](今回のcanonical
 * measurement planでは実測対象外。mockで補完するという意味ではなく、legacy mock
 * 診断経路はこれまでどおり別経路で動作する)とする。Geminiは実装が存在しない間、
 * いずれの質問の対象にも含めない(「未実装providerを常にunavailableとして分母に
 * 入れない」という確定済み方針に従う)。
 */
export const MEASUREMENT_PLAN: MeasurementPlan = {
  planVersion: MEASUREMENT_PLAN_VERSION,
  questions: PATIENT_QUESTIONS.map((question) => ({
    question,
    targetProviders: AI_MEASUREMENT_TARGET_QUESTIONS.has(question) ? ["openai"] : [],
  })),
};

/**
 * MeasurementPlanのsanity invariant違反を表すエラー。
 * 2026-09-07のユーザー指示: 純粋validation関数として実装し、violationがあれば
 * このエラーをthrowする(値を黙って補正・握りつぶさない)。
 */
export class MeasurementPlanSanityError extends Error {}

const KNOWN_PROVIDER_IDS: readonly AiProviderId[] = ["openai", "gemini"];

/**
 * MeasurementPlanのsanity invariantを検証する純粋関数。DB/ネットワーク等の
 * 副作用は一切持たない。違反があればMeasurementPlanSanityErrorをthrowする。
 *
 * 検証するinvariant(2026-09-07のユーザー指示、最低限のもの):
 * 1. planVersionが空文字(トリム後)でない
 * 2. question重複なし
 * 3. 同一質問内でtargetProviders重複なし
 * 4. targetProvidersの各要素はAiProviderId("openai"|"gemini")のみ
 * targetProviders=[]は正当な状態として許可する(検証エラーにしない)。
 */
/**
 * PATIENT_QUESTIONS(runFreeDiagnosis.ts)に存在する質問について、MEASUREMENT_PLANに
 * 対応するentryが存在しない場合を表すエラー(2026-09-07のユーザー指示: measurementCoverage
 * 加算的接続ラウンド)。silent nullにせず、planと質問定義のdriftを早期検出するために
 * 明示的にthrowする。
 */
export class MeasurementPlanQuestionNotFoundError extends Error {}

/**
 * 指定したquestionに対応するMeasurementPlanQuestionEntryを取得する純粋関数。
 * 見つからない場合はMeasurementPlanQuestionNotFoundErrorをthrowする(planと質問定義の
 * driftをsilent nullではなく明示的エラーとして早期検出するため。2026-09-07のユーザー指示)。
 */
export function findMeasurementPlanEntry(
  plan: MeasurementPlan,
  question: string
): MeasurementPlanQuestionEntry {
  const entry = plan.questions.find((q) => q.question === question);
  if (!entry) {
    throw new MeasurementPlanQuestionNotFoundError(
      `MeasurementPlan (planVersion='${plan.planVersion}') has no entry for question: '${question}'`
    );
  }
  return entry;
}

export function validateMeasurementPlan(plan: MeasurementPlan): void {
  if (plan.planVersion.trim().length === 0) {
    throw new MeasurementPlanSanityError("planVersion must not be empty");
  }

  const seenQuestions = new Set<string>();
  for (const entry of plan.questions) {
    if (seenQuestions.has(entry.question)) {
      throw new MeasurementPlanSanityError(`duplicate question in plan: '${entry.question}'`);
    }
    seenQuestions.add(entry.question);

    const seenProviders = new Set<AiProviderId>();
    for (const providerId of entry.targetProviders) {
      if (!KNOWN_PROVIDER_IDS.includes(providerId)) {
        throw new MeasurementPlanSanityError(
          `question '${entry.question}': unknown providerId '${providerId}'`
        );
      }
      if (seenProviders.has(providerId)) {
        throw new MeasurementPlanSanityError(
          `question '${entry.question}': duplicate targetProviders entry '${providerId}'`
        );
      }
      seenProviders.add(providerId);
    }
  }
}
