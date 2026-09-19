import type { UnavailableReason } from "@/domain/diagnosis/types";

/**
 * 実AI計測provider(OpenAI Web Search API / Gemini API + Google Search Grounding)導入の
 * 最初の段階(2026-09-07のユーザー指示)。
 *
 * docs/AI_MEASUREMENT_PROVIDER_DESIGN_2026-09-07.md(ユーザー承認済み設計書)のI章用語表
 * に対応するcanonical(正式)な測定ドメイン型。
 *
 * 重要: このファイル・このモジュール配下(src/domain/ai-measurement/**)は、現時点では
 * どこからも(runFreeDiagnosis.ts/diagnosisRepository.ts/composition root等)呼び出されて
 * いない、独立した新規モジュールである。既存の src/server/providers/ai/types.ts の
 * legacy `AiObservationResult`(dataSource: "mock" | "live")はこのラウンドでは一切変更・
 * 置き換えしない(ユーザー指示「既存mock診断を壊さないよう、変更範囲を最小化」に対応)。
 * 実際に両者を接続する作業(production composition rootへの接続)は、今回明示的に禁止
 * されている。
 */

/**
 * 観測がどのシステムによって生成されたか(設計書17章の`sourceType`をそのまま踏襲)。
 * legacyな`dataSource: "mock" | "live"`から、承認済み設計の呼称へ移行する。
 * "live"という曖昧な呼称をやめ、"ai_provider"(実provider経由)に統一する。
 */
export type AiMeasurementSourceType = "mock" | "ai_provider";

/**
 * 観測(または観測内の個別フィールド)がどの確度で得られた値かを示す(設計書I章の用語表)。
 * - "measured": search tool callが実際に発生し、その結果に基づく値
 * - "reference": APIは呼べたがsearch tool callが発生しなかった(検索なしのモデル単独回答)、
 *   またはmock providerによる参考データ
 * - "unavailable": provider障害・timeout等により値を取得できなかった
 */
export type AiMeasurementStatus = "measured" | "reference" | "unavailable";

/**
 * 実provider識別子(設計書A章の呼称ルールに合わせ、消費者向けアプリ名(ChatGPT/Gemini単体)
 * ではなく発行元APIで呼ぶ)。2026-09-07のユーザー指示により確定: 今回計測するのは
 * ChatGPT一般UIではなくOpenAI APIであるため、新規に保存するAiObservationの
 * provider列には必ず"openai"を使う("chatgpt"を新規保存には使わない)。既存mock
 * データのprovider値("chatgpt"|"gemini")はlegacyのまま変更不要(sourceType="mock"の
 * 既存行のみが対象であり、sourceType="ai_provider"の新規行とは混同しない)。
 */
export type AiProviderId = "openai" | "gemini";

/**
 * 個々のフィールド(mentioned/recommendationRank/citations/competitorMentions等)が
 * どのように導出されたかを示す軸。observation全体のmeasurementStatusとは独立して
 * フィールド単位で保持する(設計書E章: rankは観測全体がmeasuredでも常にprovisional/
 * estimatedであることを型で表現するための仕組み)。
 * - "direct": provider応答から直接取得した値(例: citationのURLそのもの)
 * - "derived": provider応答から機械的に導出した値(例: 応答本文からのmention判定)
 * - "estimated": 発見的・推定的なロジックで導いた値(例: 本文内言及順によるrank推定)
 * - null: 対応するフィールドのmeasurementStatusが"unavailable"のとき(値自体が存在しない)
 */
export type FieldDerivation = "direct" | "derived" | "estimated" | null;

/**
 * フィールド単位のprovenance(2軸)。
 * measurementStatus: そのフィールド自身の確度(観測全体のmeasurementStatusと一致するとは限らない)。
 * derivation: そのフィールドの値がどう導出されたか。
 */
export interface FieldProvenance {
  measurementStatus: AiMeasurementStatus;
  derivation: FieldDerivation;
}

/**
 * mentioned/recommendationRank/citations/competitorMentionsの4フィールド分のprovenance。
 * ユーザー指示の原則(OpenAI実測回答の場合):
 * - mentioned      → measured + derived
 * - recommendationRank → measured + estimated
 * - citations      → measured + direct
 * - competitorMentions → measured + derived
 */
export interface AiObservationFieldProvenance {
  mentioned: FieldProvenance;
  recommendationRank: FieldProvenance;
  citations: FieldProvenance;
  competitorMentions: FieldProvenance;
}

/**
 * provider応答のusage(token数・検索回数等)。実際のAPI接続前のこの段階では、
 * fixture/adapterがprovider応答から読み取れた範囲のみを保持する緩い構造にする
 * (設計書15章: 実装後はprovider response/usageから実使用量を計測する)。
 */
export interface AiMeasurementUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  toolCallCount: number | null;
}

/**
 * measurementMeta本体(設計書11章・C章)。
 * sourceType==="ai_provider"の観測には必須(domain invariant、invariants.ts参照)。
 */
export interface AiObservationMeasurementMeta {
  /** このmeasurementMeta構造自体のバージョン(将来の構造変更に備える)。 */
  schemaVersion: string;
  /** 使用したtool種別。OpenAIなら"web_search"、Geminiなら"google_search"。
   *  検索が実行されなかった/providerエラー時もtool種別自体は固定(そのprovider実装が
   *  使うツールの種類)なのでnullにはしない。 */
  toolType: "web_search" | "google_search";
  /** search tool callが実際に発生したか(設計書C章)。APIを呼んだだけでtrueにしない。 */
  searchExecuted: boolean;
  /** 実行された検索クエリ(発生していない場合は空配列)。 */
  searchQueries: string[];
  /** パース・判定ロジックのバージョンタグ(設計書11章)。 */
  measurementLogicVersion: string;
  /** プロンプト文面のバージョンタグ(設計書11章)。 */
  promptVersion: string;
  /** provider応答のresponse id(取得できない場合はnull。例: provider障害時)。 */
  providerResponseId: string | null;
  /** provider応答が実際に報告したモデルID(取得できない場合はnull)。 */
  providerReportedModelId: string | null;
  /** token使用量等。取得できない場合はnull(0で埋めない)。 */
  usage: AiMeasurementUsage | null;
  /** フィールド単位のprovenance(2軸)。 */
  fieldProvenance: AiObservationFieldProvenance;
}

/**
 * canonical(正式)なAI測定観測結果。
 * legacyな`AiObservationResult`(src/server/providers/ai/types.ts)と役割は同じだが、
 * dataSource: "mock"|"live" 中心の構造から、sourceType/measurementStatus/measurementMeta/
 * field provenanceを持つ構造へ移行したもの。
 *
 * mentioned/citations/competitorMentionsをnullable化しているのは、Prisma
 * `AiObservation`テーブルが2026-09-07のPhase1で同じ理由(SQL NULL=未測定/unavailable、
 * "[]"=測定して0件、という区別を失わない)によりnullable化されているのに合わせるため。
 */
export interface AiMeasurementObservation {
  question: string;
  providerId: AiProviderId;
  /** 実際に呼び出したモデルID。env(OPENAI_AI_MEASUREMENT_MODEL等)で設定される想定の値を
   *  そのまま保持する(コードにモデル名を固定しない、設計書3章)。 */
  model: string;
  sourceType: AiMeasurementSourceType;
  measurementStatus: AiMeasurementStatus;
  /** 医院がAIの回答内で言及されたか。measurementStatus==="unavailable"のときは必ずnull。 */
  mentioned: boolean | null;
  /** 回答本文内の言及順による推定順位。検索順位(SERP順位)ではない(設計書6章)。
   *  measurementStatus==="unavailable"のとき、または医院が言及されなかったときはnull。 */
  recommendationRank: number | null;
  /** 引用URL一覧(未測定/unavailableはnull、測定して0件は空配列)。 */
  citations: string[] | null;
  /** AI回答本文から抽出した競合医院候補名(設計書F章: 実在確定済みの競合ではない、
   *  derived/provisionalなcandidateとしてのみ扱う。MockCompetitorProviderの配列とは
   *  型・生成経路ともに分離しており、同じ配列へマージしない)。 */
  competitorMentions: string[] | null;
  /** 医院の商圏・エリア情報。P0はまだ収集手段が無いため常にnull(legacyと同じ扱い)。 */
  region: string | null;
  /** 人間が読める根拠の要約(mention判定に使ったテキストスパン等)。 */
  evidence: string;
  /** measurementStatus==="unavailable"のときのみ非null。それ以外は必ずnull。 */
  unavailableReason: UnavailableReason | null;
  /**
   * 「推定・ヒューリスティックな値であるか」を示す観測単位の既存フラグ(Prisma
   * `AiObservation.provisional`列にそのまま対応する)。sourceType==="mock"のとき常にtrue。
   * 2026-09-07時点の未解決事項: rank等のフィールド単位の確度は今回導入した
   * fieldProvenanceが正式な情報源であり、この観測単位のprovisionalフラグとの関係
   * (どちらを正とするか、両立させるか)は実API接続前に整理が必要(最終報告I参照)。
   */
  provisional: boolean;
  /** sourceType==="ai_provider"のとき必須(domain invariantで検証)。mock/referenceはnull。 */
  measurementMeta: AiObservationMeasurementMeta | null;
  capturedAt: string;
}
