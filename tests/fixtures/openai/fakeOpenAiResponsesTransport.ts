import type {
  OpenAiResponsesTransport,
  OpenAiTransportRequest,
  OpenAiTransportResult,
} from "@/server/providers/ai-measurement/openai/openAiResponsesTransport";

/**
 * OpenAiResponsesClientのretry/timeout/error classification契約を検証するための
 * fake transport(2026-09-08のユーザー指示: Phase 1では実HTTP通信を行わない)。
 *
 * scriptに指定した結果を呼び出し順に1つずつ返す(配列の最後の要素に達した後は
 * 最後の要素を返し続ける)。呼び出しごとの実際のinputを記録し、テストから
 * 「requested modelが保持されているか」「timeoutMsが渡っているか」等を検証できる
 * ようにする。
 */
export class FakeOpenAiResponsesTransport implements OpenAiResponsesTransport {
  readonly name = "fake-openai-responses-transport";
  readonly receivedRequests: OpenAiTransportRequest[] = [];
  private callCount = 0;

  constructor(private readonly script: OpenAiTransportResult[]) {
    if (script.length === 0) {
      throw new Error("FakeOpenAiResponsesTransport requires at least one scripted result");
    }
  }

  async request(input: OpenAiTransportRequest): Promise<OpenAiTransportResult> {
    this.receivedRequests.push(input);
    const index = Math.min(this.callCount, this.script.length - 1);
    this.callCount++;
    return this.script[index]!;
  }

  get callTimes(): number {
    return this.callCount;
  }
}

/** 成功結果(web_search_callあり)のscript要素を組み立てる最小ヘルパー。 */
export function successResult(overrides?: {
  id?: string;
  model?: string;
  searchQuery?: string;
  messageText?: string;
  citationUrl?: string;
}): Extract<OpenAiTransportResult, { ok: true }> {
  return {
    ok: true,
    raw: {
      id: overrides?.id ?? "resp_fake_1",
      model: overrides?.model ?? "fake-model",
      output: [
        {
          type: "web_search_call",
          id: "ws_fake_1",
          status: "completed",
          action: { type: "search", query: overrides?.searchQuery ?? "fake query" },
        },
        {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: overrides?.messageText ?? "fake response text",
              annotations: overrides?.citationUrl
                ? [{ type: "url_citation", url: overrides.citationUrl }]
                : [],
            },
          ],
        },
      ],
      usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
    },
  };
}

export function timeoutResult(message = "timed out"): Extract<OpenAiTransportResult, { ok: false }> {
  return { ok: false, kind: "timeout", message };
}

/** 実際にtimeoutしたわけではない、接続断等の一時的なネットワーク障害(2026-09-08の
 *  ユーザー指示: timeoutとnetwork_errorは事実として別物であり、混同しない)。 */
export function networkErrorResult(
  message = "network connection reset"
): Extract<OpenAiTransportResult, { ok: false }> {
  return { ok: false, kind: "network_error", message };
}

export function rateLimitedResult(
  message = "429 rate limited"
): Extract<OpenAiTransportResult, { ok: false }> {
  return { ok: false, kind: "http_error", status: 429, message };
}

export function serverErrorResult(
  status = 500,
  message = "server error"
): Extract<OpenAiTransportResult, { ok: false }> {
  return { ok: false, kind: "http_error", status, message };
}

export function authFailureResult(
  status = 401,
  message = "auth failed"
): Extract<OpenAiTransportResult, { ok: false }> {
  return { ok: false, kind: "http_error", status, message };
}

export function malformedResponseResult(
  message = "malformed response"
): Extract<OpenAiTransportResult, { ok: false }> {
  return { ok: false, kind: "malformed_response", message };
}
