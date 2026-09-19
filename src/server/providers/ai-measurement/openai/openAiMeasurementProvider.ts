import type { AiMeasurementObservation } from "@/domain/ai-measurement/types";
import type {
  AiMeasurementObservationInput,
  AiMeasurementProvider,
} from "@/domain/ai-measurement/provider";
import {
  MEASUREMENT_PLAN,
  findMeasurementPlanEntry,
  type MeasurementPlan,
} from "@/domain/ai-measurement/measurementPlan";
import { validateAiMeasurementObservation } from "@/domain/ai-measurement/invariants";
import type { OpenAiFetchOutcome } from "@/server/providers/ai/openai/openAiResponseTypes";
import { convertOpenAiResponseToObservation } from "@/server/providers/ai/openai/openAiAdapter";
import { buildOpenAiRequestDescriptor } from "./openAiPromptBuilder";
import type { OpenAiRequestDescriptor } from "./openAiRequestDescriptor";

/**
 * OpenAiMeasurementProvider(Phase 2、2026-09-08のユーザー指示。同日の修正
 * ラウンドで配列レベルinvariantチェックを削除し責務を一本化)。
 *
 * Phase 1で作った client/prompt builder/normalizer/(既存)adapter を配線し、
 * `AiMeasurementProvider`インターフェースを実際に満たす実装を提供する。
 * ただし、このファイル自体はまだ実HTTP/SDKを一切呼ばない(実際の通信は
 * `OpenAiMeasurementClient`として注入されるオブジェクトの責務であり、Phase 3で
 * Phase 1の`OpenAiResponsesClient`(+実SDK transport)を注入する想定)。
 * production composition root(src/app/api/diagnosis/route.ts)にはまだ一切接続しない。
 *
 * canonical業務判定(mentioned/measured/reference/unavailable判定等)は一切ここでは
 * 行わない。既存`convertOpenAiResponseToObservation`(openAiAdapter.ts)へ100%委譲する。
 * mock fallbackは一切持たない。API失敗は必ずunavailable observation(canonical、
 * sourceType="ai_provider")として返り、legacy/mockのobservationへ置き換わることは
 * ない(このcontractはtests/unit/openAiMeasurementProvider.test.tsのtimeout/
 * rate_limited/全滅ケースのbehavior testで検証する。2026-09-08の修正ラウンド:
 * 「sourceにMockAiProviderという文字列が存在しないこと」を検査する実装依存の脆い
 * static grep testは廃止し、この振る舞いベースの検証へ一本化した)。
 *
 * 【責務の一本化(2026-09-08の修正ラウンド)】このprovider自身は「計測対象question
 * ごとにちょうど1件のobservationを返す」ことを目指して実装するが、それを自前の
 * 配列レベルinvariantチェックとして再検証することはしない。plan executionの
 * 整合性(missing observation・duplicate observation・対象providerとの不一致)を
 * 検出する責務は既存`computeMeasurementCoverage()`
 * (`MeasurementPlanExecutionMismatchError`)に一本化されている
 * (`src/domain/ai-measurement/measurementCoverage.ts`、このラウンドでも無変更)。
 * このproviderが検証するのは、observation単体の不変条件(validateAiMeasurementObservation)
 * と、入力(patientQuestions)整合性(重複・plan未存在)の2点のみ。
 */

/**
 * OpenAiMeasurementProviderが必要とする最小限のclient契約。
 * Phase 1の`OpenAiResponsesClient`(openAiResponsesClient.ts)はこのinterfaceを
 * 構造的に(以心)満たすため、`OpenAiResponsesClient`自体への変更は一切不要。
 * テストでは決定的なfake実装をこのinterfaceに対して用意する
 * (tests/fixtures/openai/fakeOpenAiMeasurementClient.ts)。
 */
export interface OpenAiMeasurementClient {
  fetch(descriptor: OpenAiRequestDescriptor): Promise<OpenAiFetchOutcome>;
}

/** requestedModelが空文字(トリム後)で構築された場合のエラー。silent defaultは行わない。 */
export class InvalidRequestedModelError extends Error {}

/** input.patientQuestions内に同一質問が重複して存在する場合のエラー。
 *  重複を黙って1回だけ実行する・重複回数だけ実行する、のどちらも行わず、
 *  呼び出し元のバグとして早期に検出する。 */
export class DuplicatePatientQuestionError extends Error {}

export interface OpenAiMeasurementProviderOptions {
  /** 省略時は本番用のMEASUREMENT_PLANを使う。testでは差し替え可能にする。 */
  plan?: MeasurementPlan;
  /** capturedAt算出関数(省略時は`new Date().toISOString()`)。
   *  同一observe()呼び出し内の全questionで同じcapturedAtを共有するため、
   *  observe()の先頭で1回だけ呼び出す。 */
  now?: () => string;
}

export class OpenAiMeasurementProvider implements AiMeasurementProvider {
  readonly name = "openai-measurement-provider";

  private readonly plan: MeasurementPlan;
  private readonly now: () => string;

  constructor(
    private readonly requestedModel: string,
    private readonly client: OpenAiMeasurementClient,
    options: OpenAiMeasurementProviderOptions = {}
  ) {
    if (requestedModel.trim().length === 0) {
      throw new InvalidRequestedModelError("requestedModel must not be empty");
    }
    this.plan = options.plan ?? MEASUREMENT_PLAN;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async observe(input: AiMeasurementObservationInput): Promise<AiMeasurementObservation[]> {
    // 重複質問チェック(observeOneQuestionを同一質問に対して複数回発行してしまう
    // バグを未然に防ぐ。input.patientQuestions自体の重複は呼び出し元のバグとして
    // 明示的にthrowする)。
    const seenQuestions = new Set<string>();
    for (const question of input.patientQuestions) {
      if (seenQuestions.has(question)) {
        throw new DuplicatePatientQuestionError(
          `input.patientQuestions contains a duplicate question: '${question}'`
        );
      }
      seenQuestions.add(question);
    }

    // 【P0暫定】このproviderが直接MEASUREMENT_PLANを参照して対象質問を選定する
    // 構造は、現時点でopenaiという単一providerしか実装が存在しないためのP0暫定
    // 実装である。将来複数provider化時はorchestratorがMeasurementPlan.
    // targetProvidersを見てproviderごとに対象質問をdispatchする構造へ移行候補
    // (2026-09-08のユーザー指示)。
    //
    // input.patientQuestionsに含まれる「全ての」質問についてMEASUREMENT_PLAN上の
    // 対応entryを取得する(対象外questionだけをスキップするのではなく、まず全件を
    // 検証する)。MEASUREMENT_PLANに存在しない質問はsilent ignoreせず、
    // findMeasurementPlanEntryが投げるMeasurementPlanQuestionNotFoundErrorを
    // そのまま伝播させる(planと質問定義のdriftを早期検出する、という既存方針を
    // このproviderでも踏襲する)。
    const planEntries = input.patientQuestions.map((question) =>
      findMeasurementPlanEntry(this.plan, question)
    );

    // 今回計測対象として選ばれた(targetProvidersに"openai"を含む)質問のみを実行する。
    // targetProviders=[]の質問はclient.fetch()を呼ばず、observationも生成しない
    // (measurementCoverageの既存セマンティクス上、0/0として扱われる正当な状態)。
    const targetQuestions = planEntries
      .filter((entry) => entry.targetProviders.includes("openai"))
      .map((entry) => entry.question);

    // 1回のobserve()呼び出し内の全questionで同じcapturedAtを共有する
    // (再現性のため、questionごとに実時刻を取得しない)。
    const capturedAt = this.now();

    // 1質問1API call・並列実行(2026-09-08のユーザー指示で正式採用)。
    // client.fetch()はPhase 1の設計上、API呼び出し自体の失敗(timeout/rate_limited/
    // fetch_failed等)を例外としてthrowせず、必ずOpenAiFetchOutcomeとして返す
    // (openAiResponsesClient.tsのfetch()実装を参照)。そのためPromise.all()で
    // 安全に並列化できる(1問の失敗が他の問いの結果や成功したPromiseを握り潰さない)。
    // これに対し、InvalidRequestedModelError/DuplicatePatientQuestionError/
    // MeasurementPlanQuestionNotFoundErrorのような設定ミス・プログラミングエラーは
    // 意図的にthrow/伝播させる(一時的なAPI障害ではなく、呼び出し側の不整合を表すため)。
    //
    // 【2026-09-08の修正: 配列レベルinvariantチェックを削除】以前の版はここで
    // observations配列がtargetQuestionsと過不足なく一致するかを自前で再検証する
    // 独自チェック(assertObservationsMatchTargets、専用error)を持っていたが、
    // この責務は既存computeMeasurementCoverage()のMeasurementPlanExecutionMismatchError
    // と重複しており、責務を一本化するため削除した(measurementCoverage.ts自体は
    // 今回無変更)。このメソッドはobservation単体の不変条件(validateAiMeasurementObservation、
    // observeOneQuestion内で実施)と、入力側の整合性(重複質問・plan未存在質問、
    // このメソッド冒頭で実施)のみを検証する。
    return Promise.all(
      targetQuestions.map((question) => this.observeOneQuestion(question, input, capturedAt))
    );
  }

  private async observeOneQuestion(
    question: string,
    input: AiMeasurementObservationInput,
    capturedAt: string
  ): Promise<AiMeasurementObservation> {
    // prompt生成: clinicName/clinicUrl/competitor名を一切渡さない
    // (buildOpenAiRequestDescriptorはそもそもこれらを引数に取らない構造になっている。
    // 2026-09-08のユーザー指示: prompt生成とresponse後matchingの分離)。
    const descriptor = buildOpenAiRequestDescriptor(question, this.requestedModel);

    const outcome: OpenAiFetchOutcome = await this.client.fetch(descriptor);

    // response後matching: clinicName/officialClinicUrlはここ(adapter呼び出し)でのみ
    // 使う。competitorsは既存ConvertOpenAiResponseInputにそもそもフィールドが無い
    // ため渡さない(adapter側がテキストからのpattern抽出のみで競合candidateを得る)。
    // regionは既存adapter契約(P0は医院の商圏情報を収集する手段が無いためnull)に従い、
    // 新しいlocation型の導入や住所からの推測は一切行わない。
    const observation = convertOpenAiResponseToObservation({
      question,
      clinicName: input.clinicName,
      officialClinicUrl: input.clinicUrl,
      region: null,
      outcome,
      capturedAt,
      // provider障害時にresponse.modelが取得できない場合のfallback。
      // このproviderが実際にrequestしたmodelをそのまま渡す。
      fallbackModelId: this.requestedModel,
    });

    // 【validation方針: 案A採用】convertOpenAiResponseToObservation()は内部で既に
    // validateAiMeasurementObservation()を呼んでいるため、同じobservationに対して
    // ここでもう一度呼んでも、今回の1回の変換に対する追加の検出力は無い(全く同じ
    // 関数・同じ入力・同じ結果であるため)。それでも、「将来誰かがadapter内部の
    // 検証呼び出しを気づかず削除してしまう」という回帰に対する防御として、
    // 二重validationによる実害が無い(純粋関数・副作用無し・コストも無視できる)
    // ためここでも呼び出す(2026-09-08のユーザー指示「二重validationによる害が
    // 無いならA寄りを優先」に対応)。
    validateAiMeasurementObservation(observation);

    return observation;
  }
}
