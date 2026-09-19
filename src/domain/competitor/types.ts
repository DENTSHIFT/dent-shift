import type { UnavailableReason } from "../diagnosis/types";
import type { MeasurementCoverage } from "../ai-measurement/measurementCoverage";

export interface CompetitorClinic {
  id: string;
  name: string;
  url?: string;
  distanceKm?: number;
}

export type QuestionOutcomeStatus = "win" | "close" | "lose" | "insufficient_data";

/**
 * 「なぜ負けている?」root cause属性(2026-09-06のユーザー指示、確定設計)。
 * 45項目カタログのrootCauseKey命名規約(`${DomainKey}:${criterionKey}`)を再利用する。
 * P0では質問単位の直接signal(competitorMentions/mentioned)のみから機械的に判定可能な
 * "AIO:citation_acquisition"と"AIO:ai_search_presence"の2種類のみが実際には生成される
 * (docs/AIO_WHY_LOSING_ROOTCAUSE_DESIGN_2026-09-06.md 2節)。他の3値は将来のprovider実装で
 * 質問単位の構造化signalが追加された時点のための型としての予約。
 */
export type AioLossRootCauseKey =
  | "AIO:ai_search_presence"
  | "AIO:citation_acquisition"
  | "AIO:recommendation_rank"
  | "AIO:information_accuracy"
  | "AIO:question_domain_coverage"
  | "aio-loss:unattributed";

/** "attributed"=原因を特定できた。"insufficient_evidence"=根拠不足で特定できない(捏造しない)。
 *  "not_applicable"=status!=="lose"のため判定対象外。 */
export type AioLossAttributionStatus = "attributed" | "insufficient_evidence" | "not_applicable";

export type AioLossConfidence = "high" | "medium" | "low";

/**
 * 全体root cause TOP3の集約結果(1件=1 rootCauseKey)。questionResults(永続化済み)から
 * 都度再集約するため、これ自体は永続化しない
 * (docs/AIO_WHY_LOSING_ROOTCAUSE_DESIGN_2026-09-06.md 8節)。
 */
export interface AioLossRootCauseSummary {
  rootCauseKey: AioLossRootCauseKey; // "aio-loss:unattributed"はランキング対象外のためここには出ない
  rootCauseLabel: string;
  /** トレーサビリティ: この原因の根拠になった質問一覧(将来UIでの詳細展開用) */
  linkedQuestions: string[];
  affectedQuestionCount: number;
  /** 複数質問が同一原因に紐づく場合、最も弱い(low<medium<high の意味で最小)confidenceに合わせる */
  confidence: AioLossConfidence;
  /** linkedQuestions全体でユニークな競合名の件数(ranking要素の1つ) */
  competitorGapStrength: number;
  isProvisional: boolean;
  analysisVersion: string;
}

export interface PatientQuestionResult {
  question: string;
  status: QuestionOutcomeStatus;
  // 「原因です」と断定しない(引き継ぎ書8.3章)。確度を伴う表現にする
  evidence: string[];
  /**
   * status === "insufficient_data" のときのみ "insufficient_data"(必須)。
   * win/close/loseのときは必ずnull(2026-09-06のユーザー指示④ 基本ルール1・2・4)。
   */
  unavailableReason: UnavailableReason | null;

  // 2026-09-06:「なぜ負けている?」root cause属性(質問単位・evidence-first attribution)。
  // status === "lose" のときのみ実値を持つ。それ以外は not_applicable / null / [] / false 固定。
  /** 競合が言及されているが自院は言及されていない、という質問単位の直接signal(競合との差) */
  competitorDifference: string[];
  rootCauseKey: AioLossRootCauseKey | null;
  rootCauseLabel: string | null;
  confidence: AioLossConfidence | null;
  /**
   * root cause attributionが実際にどちらの証拠源で判定を行ったか(2026-09-08のユーザー指示:
   * canonical measured loseのroot cause本接続ラウンド)。
   *
   * 重要な注意: このフィールドは`AiMeasurementObservation.sourceType`("mock"|"ai_provider"、
   * src/domain/ai-measurement/types.ts)とは名前が同じだが**別概念・別語彙体系**である。
   * こちらのPatientQuestionResult.sourceTypeは「root cause attributionの証拠源」を表す
   * フィールドであり、あちらは「個々のcanonical観測がどう生成されたか」を表す。混同しないこと。
   * (将来的にはattributionSource等へのrenameを検討してよいが、P0では現状の名前を維持する)。
   *
   * - "mock": その質問の観測群にmockが1件でも混ざればmock(機械的導出。既存パターンと同一原則。
   *   legacy経路でnon-mock観測が1件も無い場合のみ、mockをjudging evidenceとして使う)。
   * - "canonical_measurement": canonical AI計測観測(measurementStatus==="measured")のみを
   *   judging evidenceとして判定した。2026-09-08のユーザー指示によりcanonical観測を
   *   legacyの旧"live"語彙へ変換することを禁止したため、旧"live"値は退役し、この値へ
   *   置き換えた("live"はlegacy実providerが実装されたことがなく、実DBにも1件も存在しない
   *   死んだリテラルだったため、退役に伴うデータ移行は不要。詳細は実装時のB節確認結果を参照)。
   * - null: status !== "lose"(not_applicable)、またはjudging evidenceが不足している
   *   (insufficient_evidence)。
   */
  sourceType: "mock" | "canonical_measurement" | null;
  provisional: boolean;
  attributionStatus: AioLossAttributionStatus;
  /** 判定ロジックのバージョン(将来ロジック変更後も過去診断の判定根拠を再現できるようにする) */
  analysisVersion: string | null;
  /**
   * canonical AI計測観測(aiMeasurementObservations)とMEASUREMENT_PLANから算出した、
   * この質問のmeasurement coverage(2026-09-07のユーザー指示: measurementCoverageの
   * 加算的接続ラウンド)。win/close/lose判定・scoring・root causeのいずれにも使わない、
   * 表示専用の並行情報。
   * - このrunでcanonical provider(aiMeasurementProvider)が未指定の場合: null
   *   (既存mock診断との後方互換を優先する)。
   * - canonical providerが指定され、かつこの質問がMEASUREMENT_PLAN上で計測対象
   *   (targetProviders.length > 0)の場合: 実際に算出されたMeasurementCoverage。
   * - targetProviders=[](今回計測対象外)の質問: 全項目0・isPartial=falseの
   *   MeasurementCoverage(nullではない。「未計測質問である」ことを明示的な値として
   *   表現する)。
   * 既存診断(このフィールド追加前に保存されたquestionResultsJson)との後方互換のため
   * optional/nullableにしている。
   */
  measurementCoverage?: MeasurementCoverage | null;
  /**
   * この質問のstatus判定をどちらの判定系統が行ったかを示すprovenance
   * (2026-09-07のユーザー指示: win/close/loseへのcanonical measurement本接続ラウンド)。
   * 重要: statusSourceはstatus値そのものとは直交した情報である。
   * - "canonical_measurement": canonical AI計測観測(aiMeasurementObservations)に基づいて
   *   判定した。measuredProviders===0でstatus==="insufficient_data"になった場合も、
   *   判定を行った系統はcanonicalであるため引き続き"canonical_measurement"を返す
   *   ("insufficient_data"はstatusの値であり、statusSourceの値ではない)。
   * - "legacy_reference": 従来のlegacy mock観測(aiObservations)に基づいて判定した
   *   (この質問がMEASUREMENT_PLAN上で計測対象外(targetProviders=[])の場合、または
   *   このrunでcanonical provider(aiMeasurementProvider)自体が未指定の場合)。
   * 既存診断(このフィールド追加前に保存されたquestionResultsJson)との後方互換のため
   * optional/nullableにしている。
   */
  statusSource?: "canonical_measurement" | "legacy_reference";
}
