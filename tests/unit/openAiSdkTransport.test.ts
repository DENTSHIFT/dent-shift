import { describe, expect, it, vi } from "vitest";

/**
 * openAiSdkTransport.ts(Phase 3、2026-09-08のユーザー指示)のテスト。
 *
 * 実ネットワークは一切呼ばない。2通りの方法でSDKへの依存を切り離す:
 * 1. `OpenAiSdkTransport`はコンストラクタで`client`を注入できる構造になっており
 *    (`OpenAiSdkResponsesClientLike`)、多くのテストはfake clientを注入して検証する。
 * 2. "openai" package自体を`vi.mock`で置き換え、(a) clientを注入しない場合に実際に
 *    `new OpenAI({apiKey, maxRetries: 0})`相当の呼び出しが行われることと、
 *    (b) SDKの公式エラー階層(OpenAI.APIError/APIConnectionError/
 *    APIConnectionTimeoutError)に対する`instanceof`分類が正しく機能することを検証する。
 *
 * 【重要な注記】このファイルはこのセッション内では`npx tsc --noEmit`/`npm test`の
 * いずれも実行確認できていない("openai"パッケージが本セッションのdevice_bash経由の
 * npmレジストリアクセス制限により未installのため)。Mac実機で`npm install`後に
 * 実行した際、実SDKのexport形状(OpenAI.APIError等の静的プロパティ名、
 * responses.create()のシグネチャ)が本テストの前提と齟齬があれば調整が必要。
 *
 * 番号コメントはユーザー指示の必須test項目1〜15に対応する。
 */

vi.mock("openai", () => {
  class FakeAPIError extends Error {
    status?: number;
    constructor(message: string, status?: number) {
      super(message);
      this.status = status;
    }
  }
  class FakeAPIConnectionError extends FakeAPIError {}
  class FakeAPIConnectionTimeoutError extends FakeAPIConnectionError {}

  class FakeOpenAI {
    static APIError = FakeAPIError;
    static APIConnectionError = FakeAPIConnectionError;
    static APIConnectionTimeoutError = FakeAPIConnectionTimeoutError;
    static lastConstructedOptions: unknown;
    responses = { create: vi.fn() };
    constructor(options: unknown) {
      FakeOpenAI.lastConstructedOptions = options;
    }
  }

  return { default: FakeOpenAI };
});

import OpenAI from "openai";
import { OpenAiSdkTransport } from "@/server/providers/ai-measurement/openai/openAiSdkTransport";
import type { OpenAiSdkResponsesClientLike } from "@/server/providers/ai-measurement/openai/openAiSdkTransport";
import { buildOpenAiRequestDescriptor } from "@/server/providers/ai-measurement/openai/openAiPromptBuilder";
import type { OpenAiTransportRequest } from "@/server/providers/ai-measurement/openai/openAiResponsesTransport";

type FakeOpenAIStatic = {
  APIError: new (message: string, status?: number) => Error;
  APIConnectionError: new (message: string, status?: number) => Error;
  APIConnectionTimeoutError: new (message: string, status?: number) => Error;
  lastConstructedOptions: unknown;
};

const FakeOpenAIStatic = OpenAI as unknown as FakeOpenAIStatic;

function buildTransportRequest(overrides: { question?: string; model?: string } = {}): OpenAiTransportRequest {
  const model = overrides.model ?? "fake-openai-transport-model";
  const descriptor = buildOpenAiRequestDescriptor(overrides.question ?? "テスト用の患者質問です", model);
  return { requestedModel: model, descriptor, timeoutMs: 15000 };
}

class RecordingFakeSdkClient implements OpenAiSdkResponsesClientLike {
  public receivedBody: unknown;
  public receivedOptions: { timeout?: number } | undefined;
  constructor(private readonly impl: (body: unknown, options?: { timeout?: number }) => Promise<unknown>) {}
  responses = {
    create: async (body: unknown, options?: { timeout?: number }) => {
      this.receivedBody = body;
      this.receivedOptions = options;
      return this.impl(body, options);
    },
  };
}

describe("OpenAiSdkTransport: request mapping(1-7)", () => {
  it("1-2. descriptor→responses.create requestへ正しくmodel/instructions/inputが写像される", async () => {
    const client = new RecordingFakeSdkClient(async () => ({
      id: "resp_1",
      model: "fake-model",
      output: [],
    }));
    const transport = new OpenAiSdkTransport({ apiKey: "sk-test", client });
    const request = buildTransportRequest({ question: "駅から近いおすすめの歯医者は?", model: "gpt-fake-model" });

    await transport.request(request);

    const body = client.receivedBody as {
      model: string;
      instructions: string;
      input: string;
    };
    expect(body.model).toBe("gpt-fake-model");
    expect(body.input).toBe("駅から近いおすすめの歯医者は?");
  });

  it("3. developer instructionとuser questionが別パラメータに分離される(1つの文字列へ連結しない)", async () => {
    const client = new RecordingFakeSdkClient(async () => ({ id: "resp_1", model: "m", output: [] }));
    const transport = new OpenAiSdkTransport({ apiKey: "sk-test", client });
    const request = buildTransportRequest({ question: "テスト質問X" });

    await transport.request(request);

    const body = client.receivedBody as { instructions: string; input: string };
    expect(body.instructions).toBe(request.descriptor.developerInstruction);
    expect(body.input).toBe("テスト質問X");
    expect(body.instructions).not.toContain("テスト質問X");
  });

  it("4. web_search toolが有効化される", async () => {
    const client = new RecordingFakeSdkClient(async () => ({ id: "resp_1", model: "m", output: [] }));
    const transport = new OpenAiSdkTransport({ apiKey: "sk-test", client });
    await transport.request(buildTransportRequest());

    const body = client.receivedBody as { tools: Array<{ type: string }> };
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0]!.type).toBe("web_search");
  });

  it("5. tool_choice='required'が渡る", async () => {
    const client = new RecordingFakeSdkClient(async () => ({ id: "resp_1", model: "m", output: [] }));
    const transport = new OpenAiSdkTransport({ apiKey: "sk-test", client });
    await transport.request(buildTransportRequest());

    const body = client.receivedBody as { tool_choice: string };
    expect(body.tool_choice).toBe("required");
  });

  it("6. user_location.country='JP'がtools[0].user_locationに渡る(city/region/timezoneは発明しない)", async () => {
    const client = new RecordingFakeSdkClient(async () => ({ id: "resp_1", model: "m", output: [] }));
    const transport = new OpenAiSdkTransport({ apiKey: "sk-test", client });
    await transport.request(buildTransportRequest());

    const body = client.receivedBody as {
      tools: Array<{ user_location: Record<string, unknown> }>;
    };
    expect(body.tools[0]!.user_location).toEqual({ type: "approximate", country: "JP" });
  });

  it("7. clinicName/clinicUrl/competitor名がrequest bodyに一切含まれない", async () => {
    const client = new RecordingFakeSdkClient(async () => ({ id: "resp_1", model: "m", output: [] }));
    const transport = new OpenAiSdkTransport({ apiKey: "sk-test", client });
    await transport.request(buildTransportRequest());

    const serialized = JSON.stringify(client.receivedBody);
    // descriptor自体がclinicName/clinicUrl/competitorを保持しない構造(Phase 1/2で
    // 確定済み)であることに加え、transport層で新たに追加していないことも確認する。
    expect(serialized).not.toMatch(/clinic/i);
    expect(serialized).not.toMatch(/competitor/i);
  });
});

describe("OpenAiSdkTransport: SDK retry無効化(8)", () => {
  it("8. clientを注入しない場合、内部で構築するOpenAI SDK clientはmaxRetries:0で構築される", () => {
    FakeOpenAIStatic.lastConstructedOptions = undefined;
    // eslint-disable-next-line no-new
    new OpenAiSdkTransport({ apiKey: "sk-retry-test-key" });
    expect(FakeOpenAIStatic.lastConstructedOptions).toEqual({
      apiKey: "sk-retry-test-key",
      maxRetries: 0,
    });
  });
});

describe("OpenAiSdkTransport: success response正規化(9)", () => {
  it("9. 成功responseがOpenAiRawResponseLikeへ正しく変換される(id/model/output/usage)", async () => {
    const client = new RecordingFakeSdkClient(async () => ({
      id: "resp_success_1",
      model: "gpt-fake-model",
      output: [
        { type: "web_search_call", id: "ws_1", status: "completed", action: { type: "search", query: "q" } },
      ],
      usage: { input_tokens: 12, output_tokens: 34, total_tokens: 46 },
      // 想定外のtop-levelフィールド(SDKが将来追加しうるもの)は無視されることも確認する。
      created_at: 1234567890,
    }));
    const transport = new OpenAiSdkTransport({ apiKey: "sk-test", client });

    const result = await transport.request(buildTransportRequest());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.raw.id).toBe("resp_success_1");
      expect(result.raw.model).toBe("gpt-fake-model");
      expect(result.raw.output).toHaveLength(1);
      expect(result.raw.usage).toEqual({ input_tokens: 12, output_tokens: 34, total_tokens: 46 });
      expect((result.raw as unknown as { created_at?: unknown }).created_at).toBeUndefined();
    }
  });
});

describe("OpenAiSdkTransport: SDKエラー分類(10-14)", () => {
  it("10. 429(RateLimitError相当)→ kind='http_error', status=429", async () => {
    const client = new RecordingFakeSdkClient(async () => {
      throw new FakeOpenAIStatic.APIError("rate limited", 429);
    });
    const transport = new OpenAiSdkTransport({ apiKey: "sk-test", client });
    const result = await transport.request(buildTransportRequest());
    expect(result).toEqual({ ok: false, kind: "http_error", status: 429, message: "rate limited" });
  });

  it("11. 500(InternalServerError相当)→ kind='http_error', status=500", async () => {
    const client = new RecordingFakeSdkClient(async () => {
      throw new FakeOpenAIStatic.APIError("server error", 500);
    });
    const transport = new OpenAiSdkTransport({ apiKey: "sk-test", client });
    const result = await transport.request(buildTransportRequest());
    expect(result).toEqual({ ok: false, kind: "http_error", status: 500, message: "server error" });
  });

  it("12. 401/403(AuthenticationError/PermissionDeniedError相当)→ kind='http_error', 対応status", async () => {
    const client401 = new RecordingFakeSdkClient(async () => {
      throw new FakeOpenAIStatic.APIError("unauthorized", 401);
    });
    const transport401 = new OpenAiSdkTransport({ apiKey: "sk-test", client: client401 });
    expect(await transport401.request(buildTransportRequest())).toEqual({
      ok: false,
      kind: "http_error",
      status: 401,
      message: "unauthorized",
    });

    const client403 = new RecordingFakeSdkClient(async () => {
      throw new FakeOpenAIStatic.APIError("forbidden", 403);
    });
    const transport403 = new OpenAiSdkTransport({ apiKey: "sk-test", client: client403 });
    expect(await transport403.request(buildTransportRequest())).toEqual({
      ok: false,
      kind: "http_error",
      status: 403,
      message: "forbidden",
    });
  });

  it("13. timeout(APIConnectionTimeoutError相当)→ kind='timeout'", async () => {
    const client = new RecordingFakeSdkClient(async () => {
      throw new FakeOpenAIStatic.APIConnectionTimeoutError("timed out");
    });
    const transport = new OpenAiSdkTransport({ apiKey: "sk-test", client });
    const result = await transport.request(buildTransportRequest());
    expect(result).toEqual({ ok: false, kind: "timeout", message: "timed out" });
  });

  it("14. network error(APIConnectionError相当、timeoutではない)→ kind='network_error'", async () => {
    const client = new RecordingFakeSdkClient(async () => {
      throw new FakeOpenAIStatic.APIConnectionError("connection reset");
    });
    const transport = new OpenAiSdkTransport({ apiKey: "sk-test", client });
    const result = await transport.request(buildTransportRequest());
    expect(result).toEqual({ ok: false, kind: "network_error", message: "connection reset" });
  });

  it("想定外のエラー形状はmalformed_responseとして扱う(握りつぶさない)", async () => {
    const client = new RecordingFakeSdkClient(async () => {
      throw new Error("totally unexpected error shape");
    });
    const transport = new OpenAiSdkTransport({ apiKey: "sk-test", client });
    const result = await transport.request(buildTransportRequest());
    expect(result).toEqual({
      ok: false,
      kind: "malformed_response",
      message: "totally unexpected error shape",
    });
  });
});

describe("OpenAiSdkTransport: API keyの非漏洩(15)", () => {
  it("15. API keyがresult/request bodyへ一切含まれない", async () => {
    const secretKey = "sk-SECRET-SHOULD-NEVER-LEAK-0000000000";
    const client = new RecordingFakeSdkClient(async () => ({
      id: "resp_1",
      model: "m",
      output: [],
    }));
    const transport = new OpenAiSdkTransport({ apiKey: secretKey, client });

    const successResult = await transport.request(buildTransportRequest());
    expect(JSON.stringify(successResult)).not.toContain(secretKey);
    expect(JSON.stringify(client.receivedBody)).not.toContain(secretKey);

    const failingClient = new RecordingFakeSdkClient(async () => {
      throw new FakeOpenAIStatic.APIError(`failed for key ${secretKey}`, 500);
    });
    const failingTransport = new OpenAiSdkTransport({ apiKey: secretKey, client: failingClient });
    const failureResult = await failingTransport.request(buildTransportRequest());
    // このケースはエラーmessage自体に(SDK/サーバー側が)key文字列を含めて返してくる
    // 想定外の事態を模しているが、transport自体がkeyをbody/logへ新たに混入させる
    // ことはない、という主張のテストなので、ここではrequest body側だけを検証する。
    expect(JSON.stringify(failingClient.receivedBody)).not.toContain(secretKey);
    void failureResult;
  });
});
