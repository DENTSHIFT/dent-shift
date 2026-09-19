import type {
  AiMeasurementObservation,
  AiObservationFieldProvenance,
} from "@/domain/ai-measurement/types";
import { validateAiMeasurementObservation } from "@/domain/ai-measurement/invariants";
import { matchClinicMention } from "@/domain/ai-measurement/clinicMentionMatching";
import { extractCompetitorCandidates } from "@/domain/ai-measurement/competitorCandidateExtraction";
import { resolveObservationProvisional } from "@/domain/ai-measurement/observationProvisional";
import type { UnavailableReason } from "@/domain/diagnosis/types";
import type {
  OpenAiFetchOutcome,
  OpenAiMessageItem,
  OpenAiResponseFixture,
  OpenAiUrlCitationAnnotation,
  OpenAiWebSearchCallItem,
} from "./openAiResponseTypes";
import { OPENAI_PROMPT_VERSION } from "./openAiPromptVersion";

/**
 * OpenAI Responses API fixture → canonical AiMeasurementObservation変換(2026-09-07の
 * ユーザー指示、実AI計測provider実装の最初の段階)。
 *
 * 重要: このファイルはネットワーク通信を一切行わない。実際のHTTP/SDK呼び出しは
 * 今回のスコープ外であり、`OpenAiFetchOutcome`(成功/失敗の両方を表現するunion)を
 * 受け取って変換するだけの純粋関数として実装する。実API接続時、実際の呼び出し箇所が
 * try/catchでこの形へ変換してから本関数に渡す想定。
 */

export const OPENAI_MEASUREMENT_LOGIC_VERSION = "openai_responses_web_search_v1";
// OPENAI_PROMPT_VERSION自体はこのファイルでは定義しない(2026-09-08のユーザー指示:
// 一元化ラウンド)。単一source of truthである./openAiPromptVersion.tsからimportした
// ものをそのまま使う(このファイル冒頭のimport文を参照)。既存の呼び出し元(このファイル
// 内のmeasurementMeta.promptVersion生成箇所)・既存の外部importの双方が壊れないよう、
// importした束縛をこの名前のままre-exportする。
export { OPENAI_PROMPT_VERSION };
export const AI_OBSERVATION_MEASUREMENT_META_SCHEMA_VERSION = "ai_observation_measurement_meta_v1";

export interface ConvertOpenAiResponseInput {
  question: string;
  clinicName: string;
  /** 通称・旧名称等の表記ゆれ候補(任意)。 */
  clinicNameAliases?: string[];
  officialClinicUrl: string;
  /** 医院の商圏・エリア情報。P0は収集手段が無いためnullを渡す想定(legacyと同じ)。 */
  region: string | null;
  outcome: OpenAiFetchOutcome;
  capturedAt: string;
  /** provider障害時、response.modelが取得できないため代わりに使うモデルID
   *  (実装時はOPENAI_AI_MEASUREMENT_MODELの設定値を渡す想定。今回は未接続のため任意項目)。 */
  fallbackModelId?: string;
}

export function convertOpenAiResponseToObservation(
  input: ConvertOpenAiResponseInput
): AiMeasurementObservation {
  const observation = input.outcome.ok
    ? buildFromSuccessResponse(input, input.outcome.response)
    : buildFromFailure(input, input.outcome);

  // adapterが作った観測は必ずdomain invariantを満たすことをここで自己検証する
  // (パースロジックのバグを早期に検出する。設計書20章「パースロジックを検証する」)。
  validateAiMeasurementObservation(observation);
  return observation;
}

function buildFromFailure(
  input: ConvertOpenAiResponseInput,
  outcome: Extract<OpenAiFetchOutcome, { ok: false }>
): AiMeasurementObservation {
  // 設計書14章のマッピング案(timeout・5xx→temporarily_unavailable、rate limit→
  // temporarily_unavailable、認証等の恒久失敗→fetch_failed)をそのまま使う。
  const unavailableReason: UnavailableReason =
    outcome.reason === "fetch_failed" ? "fetch_failed" : "temporarily_unavailable";

  return {
    question: input.question,
    providerId: "openai",
    model: input.fallbackModelId ?? "unknown",
    sourceType: "ai_provider",
    measurementStatus: "unavailable",
    mentioned: null,
    recommendationRank: null,
    citations: null,
    competitorMentions: null,
    region: input.region,
    evidence: `[openai] provider error (${outcome.reason}): ${outcome.message}`,
    unavailableReason,
    // 2026-09-07のユーザー指示で確定: measurementStatus="unavailable"はfalse。
    provisional: resolveObservationProvisional("ai_provider", "unavailable"),
    measurementMeta: {
      schemaVersion: AI_OBSERVATION_MEASUREMENT_META_SCHEMA_VERSION,
      toolType: "web_search",
      searchExecuted: false,
      searchQueries: [],
      measurementLogicVersion: OPENAI_MEASUREMENT_LOGIC_VERSION,
      promptVersion: OPENAI_PROMPT_VERSION,
      providerResponseId: null,
      providerReportedModelId: null,
      usage: null,
      fieldProvenance: unavailableFieldProvenance(),
    },
    capturedAt: input.capturedAt,
  };
}

function buildFromSuccessResponse(
  input: ConvertOpenAiResponseInput,
  response: OpenAiResponseFixture
): AiMeasurementObservation {
  const webSearchCalls = response.output.filter(
    (item): item is OpenAiWebSearchCallItem => item.type === "web_search_call"
  );
  // 設計書C章: APIを呼んだだけで「検索実測済み」と判定しない。web_search_callの実発生のみで判定する。
  const searchExecuted = webSearchCalls.length > 0;
  const searchQueries = webSearchCalls
    .map((call) => call.action?.query)
    .filter((q): q is string => typeof q === "string" && q.length > 0);

  const messageItems = response.output.filter(
    (item): item is OpenAiMessageItem => item.type === "message"
  );
  const textContentItems = messageItems.flatMap((item) =>
    item.content.filter((c) => c.type === "output_text")
  );
  const responseText = textContentItems.map((c) => c.text).join("\n");
  const citationAnnotations: OpenAiUrlCitationAnnotation[] = textContentItems.flatMap(
    (c) => c.annotations ?? []
  );
  const citations = citationAnnotations.map((a) => a.url);

  // 設計書I章用語表: search tool callが発生しなければ"measured"ではなく"reference"
  // (検索なしのモデル単独回答)。
  const measurementStatus: "measured" | "reference" = searchExecuted ? "measured" : "reference";

  const mentionMatch = matchClinicMention({
    responseText,
    clinicName: input.clinicName,
    clinicNameAliases: input.clinicNameAliases,
    officialClinicUrl: input.officialClinicUrl,
    citations,
  });

  // 設計書8.1章・F章: 実在確定済みの競合ではなく、あくまで本文に出現した候補名として扱う。
  // mockの架空競合リストとはここでも一切混ぜない(この関数はmock競合を受け取ってすらいない)。
  const competitorCandidates = extractCompetitorCandidates({
    responseText,
    excludeNames: [input.clinicName, ...(input.clinicNameAliases ?? [])],
  });

  // 設計書6章: 検索順位(SERP順位)ではなく「本文内での言及順」による推定順位。
  // 自院と競合candidateのテキスト出現位置をまとめて昇順に並べ、自院の順位を数える。
  let recommendationRank: number | null = null;
  if (mentionMatch.mentioned && mentionMatch.matchedIndex !== null) {
    const allIndices = [
      mentionMatch.matchedIndex,
      ...competitorCandidates.map((c) => c.matchedIndex),
    ];
    const sortedUniqueIndices = [...new Set(allIndices)].sort((a, b) => a - b);
    recommendationRank = sortedUniqueIndices.indexOf(mentionMatch.matchedIndex) + 1;
  }

  const evidenceParts: string[] = [];
  evidenceParts.push(
    mentionMatch.mentioned
      ? `[openai] "${input.question}" への回答で ${input.clinicName} が言及されました` +
          (mentionMatch.evidenceSnippet ? `(該当箇所: ${mentionMatch.evidenceSnippet})` : "")
      : `[openai] "${input.question}" への回答で ${input.clinicName} の言及は確認できませんでした`
  );
  // 「citationが存在する」ことと「自院公式サイトがcitationされた」ことを分離して記録する
  // (設計書G章。evidence文字列内にも両者を混同しない形で残す)。
  if (mentionMatch.officialDomainCited) {
    evidenceParts.push(
      `自院公式ドメインがcitationされています(${mentionMatch.matchedCitationUrl ?? ""})`
    );
  } else if (citations.length > 0) {
    evidenceParts.push("citationは存在しますが、自院公式ドメインとは一致しません");
  }
  if (!searchExecuted) {
    evidenceParts.push("web検索は実行されませんでした(検索なしのモデル単独回答)");
  }

  return {
    question: input.question,
    providerId: "openai",
    model: response.model,
    sourceType: "ai_provider",
    measurementStatus,
    mentioned: mentionMatch.mentioned,
    recommendationRank,
    citations,
    competitorMentions: competitorCandidates.map((c) => c.name),
    region: input.region,
    evidence: evidenceParts.join(" / "),
    unavailableReason: null,
    // 2026-09-07のユーザー指示で確定: measurementStatus="measured"→false、
    // "reference"→true。rank自体が常にderivation="estimated"であることは、この
    // 観測単位のprovisionalフラグとは独立してfieldProvenance.recommendationRankが表現する
    // (「観測は実測だがrankだけ推定」をobservation.provisional=false かつ
    // fieldProvenance.recommendationRank.derivation="estimated"の組み合わせで表す)。
    provisional: resolveObservationProvisional("ai_provider", measurementStatus),
    measurementMeta: {
      schemaVersion: AI_OBSERVATION_MEASUREMENT_META_SCHEMA_VERSION,
      toolType: "web_search",
      searchExecuted,
      searchQueries,
      measurementLogicVersion: OPENAI_MEASUREMENT_LOGIC_VERSION,
      promptVersion: OPENAI_PROMPT_VERSION,
      providerResponseId: response.id,
      providerReportedModelId: response.model,
      usage: response.usage
        ? {
            inputTokens: response.usage.input_tokens ?? null,
            outputTokens: response.usage.output_tokens ?? null,
            toolCallCount: webSearchCalls.length,
          }
        : null,
      fieldProvenance: fieldProvenanceFor(measurementStatus),
    },
    capturedAt: input.capturedAt,
  };
}

/**
 * ユーザー指示の原則(OpenAI実測回答の場合): mentioned→derived, recommendationRank→
 * estimated, citations→direct, competitorMentions→derived。measurementStatusが
 * "reference"(検索未実行)の場合も、observation全体のmeasurementStatusをそのまま
 * 各フィールドへ反映する(値が得られなかったわけではなく、確度がmeasuredでないだけのため)。
 */
function fieldProvenanceFor(
  measurementStatus: "measured" | "reference"
): AiObservationFieldProvenance {
  return {
    mentioned: { measurementStatus, derivation: "derived" },
    recommendationRank: { measurementStatus, derivation: "estimated" },
    citations: { measurementStatus, derivation: "direct" },
    competitorMentions: { measurementStatus, derivation: "derived" },
  };
}

function unavailableFieldProvenance(): AiObservationFieldProvenance {
  return {
    mentioned: { measurementStatus: "unavailable", derivation: null },
    recommendationRank: { measurementStatus: "unavailable", derivation: null },
    citations: { measurementStatus: "unavailable", derivation: null },
    competitorMentions: { measurementStatus: "unavailable", derivation: null },
  };
}
