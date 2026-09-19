import { describe, expect, it } from "vitest";
import {
  normalizeOpenAiResponsesApiResponse,
  OpenAiResponseNormalizationError,
} from "@/server/providers/ai-measurement/openai/openAiResponseNormalizer";
import type { OpenAiRawResponseLike } from "@/server/providers/ai-measurement/openai/openAiResponsesTransport";

/**
 * normalizeOpenAiResponsesApiResponse()のテスト(2026-09-08のユーザー指示、Phase 1)。
 * SDK/API response shape相当(OpenAiRawResponseLike) → 既存OpenAiResponseFixtureへの
 * 構造変換だけを検証する。mentioned判定等のbusiness logicはここでは検証しない
 * (openAiAdapter.test.tsの既存責務のまま)。
 */

function baseRaw(overrides?: Partial<OpenAiRawResponseLike>): OpenAiRawResponseLike {
  return {
    id: "resp_raw_1",
    model: "reported-model-x",
    output: [],
    ...overrides,
  };
}

describe("normalizeOpenAiResponsesApiResponse", () => {
  it("22. web_search_callを保持する(action.query含む)", () => {
    const raw = baseRaw({
      output: [
        {
          type: "web_search_call",
          id: "ws_1",
          status: "completed",
          action: { type: "search", query: "駅前 歯科医院" },
        },
      ],
    });

    const normalized = normalizeOpenAiResponsesApiResponse(raw);

    expect(normalized.output).toHaveLength(1);
    const item = normalized.output[0]!;
    expect(item.type).toBe("web_search_call");
    if (item.type === "web_search_call") {
      expect(item.action?.query).toBe("駅前 歯科医院");
    }
  });

  it("23. message output_textを保持する", () => {
    const raw = baseRaw({
      output: [
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "回答本文です" }],
        },
      ],
    });

    const normalized = normalizeOpenAiResponsesApiResponse(raw);

    expect(normalized.output).toHaveLength(1);
    const item = normalized.output[0]!;
    expect(item.type).toBe("message");
    if (item.type === "message") {
      expect(item.content[0]?.text).toBe("回答本文です");
    }
  });

  it("24. url_citation annotationを保持する", () => {
    const raw = baseRaw({
      output: [
        {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: "回答本文です",
              annotations: [
                { type: "url_citation", url: "https://example.com/page", title: "参考ページ" },
              ],
            },
          ],
        },
      ],
    });

    const normalized = normalizeOpenAiResponsesApiResponse(raw);
    const item = normalized.output[0]!;
    expect(item.type).toBe("message");
    if (item.type === "message") {
      expect(item.content[0]?.annotations).toEqual([
        { type: "url_citation", url: "https://example.com/page", title: "参考ページ" },
      ]);
    }
  });

  it("25. response idを保持する", () => {
    const raw = baseRaw({ id: "resp_specific_id" });
    const normalized = normalizeOpenAiResponsesApiResponse(raw);
    expect(normalized.id).toBe("resp_specific_id");
  });

  it("26. provider reported modelを保持する", () => {
    const raw = baseRaw({ model: "gpt-reported-model-y" });
    const normalized = normalizeOpenAiResponsesApiResponse(raw);
    expect(normalized.model).toBe("gpt-reported-model-y");
  });

  it("27. usageを保持する", () => {
    const raw = baseRaw({ usage: { input_tokens: 5, output_tokens: 15, total_tokens: 20 } });
    const normalized = normalizeOpenAiResponsesApiResponse(raw);
    expect(normalized.usage).toEqual({ input_tokens: 5, output_tokens: 15, total_tokens: 20 });
  });

  it("28. 未知のoutput itemがあっても必要項目だけ安全に無視する", () => {
    const raw = baseRaw({
      output: [
        { type: "reasoning", id: "r_1", summary: "internal reasoning, not for us" },
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "残る回答" }],
        },
      ],
    });

    const normalized = normalizeOpenAiResponsesApiResponse(raw);

    expect(normalized.output).toHaveLength(1);
    expect(normalized.output[0]!.type).toBe("message");
  });

  it("29. raw response全体をOpenAiFetchOutcome/OpenAiResponseFixtureへコピーしない(想定外のフィールドが残らない)", () => {
    const raw = baseRaw({
      output: [
        {
          type: "web_search_call",
          id: "ws_1",
          status: "completed",
          action: { type: "search", query: "q" },
          secretDebugInfo: "should not survive normalization",
        },
      ],
    });

    const normalized = normalizeOpenAiResponsesApiResponse(raw);
    const item = normalized.output[0]!;
    expect(item).not.toHaveProperty("secretDebugInfo");
    expect(Object.keys(item).sort()).toEqual(["action", "id", "status", "type"].sort());
  });

  it("responseが必要な構造を満たさない場合はOpenAiResponseNormalizationErrorをthrowする", () => {
    expect(() =>
      normalizeOpenAiResponsesApiResponse(baseRaw({ id: "" }))
    ).toThrow(OpenAiResponseNormalizationError);
    expect(() =>
      normalizeOpenAiResponsesApiResponse(baseRaw({ output: undefined as unknown as [] }))
    ).toThrow(OpenAiResponseNormalizationError);
  });
});
