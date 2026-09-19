import type {
  OpenAiRawOutputItemLike,
  OpenAiRawResponseLike,
} from "./openAiResponsesTransport";
import type {
  OpenAiMessageContentItem,
  OpenAiMessageItem,
  OpenAiOutputItem,
  OpenAiResponseFixture,
  OpenAiUrlCitationAnnotation,
  OpenAiUsage,
  OpenAiWebSearchCallItem,
} from "@/server/providers/ai/openai/openAiResponseTypes";

/**
 * SDK/API response正規化境界(2026-09-08のユーザー指示②)。
 *
 * 責務: 「生」のtransport応答(OpenAiRawResponseLike、SDK/API response shapeに近い
 * 最小限の想定)を、既存openAiAdapter.tsが読める`OpenAiResponseFixture`形へ
 * 必要最小限だけ変換する。
 *
 * 【絶対にここへ持ち込まないもの】mentioned判定・clinic matching・competitor抽出・
 * measured/reference/unavailable判定。これらは既存のopenAiAdapter.ts(Phase 1では
 * 変更禁止)の責務であり、この関数は構造変換だけを行う。
 *
 * 未知のoutput item種別(例: 将来追加されうるreasoning等)は安全に無視する
 * (raw応答全体をそのままコピー・保持することはしない。必要なフィールドだけを
 * 個別にpickして新しいオブジェクトを構築する)。
 */
export class OpenAiResponseNormalizationError extends Error {}

export function normalizeOpenAiResponsesApiResponse(
  raw: OpenAiRawResponseLike
): OpenAiResponseFixture {
  if (typeof raw.id !== "string" || raw.id.length === 0) {
    throw new OpenAiResponseNormalizationError("response.id is missing or not a non-empty string");
  }
  if (typeof raw.model !== "string" || raw.model.length === 0) {
    throw new OpenAiResponseNormalizationError("response.model is missing or not a non-empty string");
  }
  if (!Array.isArray(raw.output)) {
    throw new OpenAiResponseNormalizationError("response.output is missing or not an array");
  }

  const output: OpenAiOutputItem[] = raw.output
    .map((item) => normalizeOutputItem(item))
    .filter((item): item is OpenAiOutputItem => item !== null);

  return {
    id: raw.id,
    model: raw.model,
    output,
    usage: normalizeUsage(raw.usage),
  };
}

function normalizeOutputItem(item: OpenAiRawOutputItemLike): OpenAiOutputItem | null {
  if (item.type === "web_search_call") {
    return normalizeWebSearchCallItem(item);
  }
  if (item.type === "message") {
    return normalizeMessageItem(item);
  }
  // 未知のoutput item種別は安全に無視する(既存adapterはweb_search_call/message以外を
  // 読まないため、構造さえ壊さなければ無視してよい。2026-09-08のユーザー指示、テスト28)。
  return null;
}

function normalizeWebSearchCallItem(item: OpenAiRawOutputItemLike): OpenAiWebSearchCallItem {
  const rawAction = item.action;
  let action: OpenAiWebSearchCallItem["action"];
  if (rawAction !== null && typeof rawAction === "object") {
    const a = rawAction as Record<string, unknown>;
    action = {
      type: typeof a.type === "string" ? a.type : "",
      query: typeof a.query === "string" ? a.query : undefined,
    };
  }
  return {
    type: "web_search_call",
    id: typeof item.id === "string" ? item.id : "",
    status: typeof item.status === "string" ? item.status : "unknown",
    action,
  };
}

function normalizeMessageItem(item: OpenAiRawOutputItemLike): OpenAiMessageItem | null {
  // 既存openAiAdapter.tsが読むのはrole="assistant"のmessageのみ想定。
  // それ以外のroleは(実APIが将来出す可能性があっても)安全に無視する。
  if (item.role !== "assistant") {
    return null;
  }
  const rawContent = Array.isArray(item.content) ? item.content : [];
  const content: OpenAiMessageContentItem[] = rawContent
    .map((c) => normalizeMessageContentItem(c))
    .filter((c): c is OpenAiMessageContentItem => c !== null);

  return {
    type: "message",
    role: "assistant",
    content,
  };
}

function normalizeMessageContentItem(raw: unknown): OpenAiMessageContentItem | null {
  if (raw === null || typeof raw !== "object") {
    return null;
  }
  const c = raw as Record<string, unknown>;
  if (c.type !== "output_text") {
    // 未知のcontent item種別(将来追加されうるもの)は無視する。
    return null;
  }
  const text = typeof c.text === "string" ? c.text : "";
  const rawAnnotations = Array.isArray(c.annotations) ? c.annotations : [];
  const annotations: OpenAiUrlCitationAnnotation[] = rawAnnotations
    .map((a) => normalizeAnnotation(a))
    .filter((a): a is OpenAiUrlCitationAnnotation => a !== null);

  return {
    type: "output_text",
    text,
    annotations: annotations.length > 0 ? annotations : undefined,
  };
}

function normalizeAnnotation(raw: unknown): OpenAiUrlCitationAnnotation | null {
  if (raw === null || typeof raw !== "object") {
    return null;
  }
  const a = raw as Record<string, unknown>;
  if (a.type !== "url_citation" || typeof a.url !== "string") {
    // url自体を持たないannotationはcitationとして扱えないため無視する。
    return null;
  }
  return {
    type: "url_citation",
    url: a.url,
    title: typeof a.title === "string" ? a.title : undefined,
    start_index: typeof a.start_index === "number" ? a.start_index : undefined,
    end_index: typeof a.end_index === "number" ? a.end_index : undefined,
  };
}

function normalizeUsage(
  raw: OpenAiRawResponseLike["usage"]
): OpenAiUsage | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  return {
    input_tokens: typeof raw.input_tokens === "number" ? raw.input_tokens : undefined,
    output_tokens: typeof raw.output_tokens === "number" ? raw.output_tokens : undefined,
    total_tokens: typeof raw.total_tokens === "number" ? raw.total_tokens : undefined,
  };
}
