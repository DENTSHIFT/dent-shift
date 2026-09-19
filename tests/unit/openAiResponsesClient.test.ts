import { describe, expect, it } from "vitest";
import {
  OpenAiResponsesClient,
  DEFAULT_MAX_ATTEMPTS,
} from "@/server/providers/ai-measurement/openai/openAiResponsesClient";
import { buildOpenAiRequestDescriptor } from "@/server/providers/ai-measurement/openai/openAiPromptBuilder";
import {
  FakeOpenAiResponsesTransport,
  authFailureResult,
  malformedResponseResult,
  networkErrorResult,
  rateLimitedResult,
  serverErrorResult,
  successResult,
  timeoutResult,
} from "../fixtures/openai/fakeOpenAiResponsesTransport";

/**
 * OpenAiResponsesClientのretry/timeout/error classification契約のテスト
 * (2026-09-08のユーザー指示、Phase 1)。実ネットワークアクセスは一切行わない
 * (すべてFakeOpenAiResponsesTransport経由)。backoffのsleepは常に注入し、
 * 実時間を待つテストは一切書かない。
 */

const DESCRIPTOR = buildOpenAiRequestDescriptor("駅から近いおすすめの歯医者は?", "fake-model");
const TIMEOUT_MS = 20_000;

function buildClient(
  transport: FakeOpenAiResponsesTransport,
  overrides?: { maxAttempts?: number }
) {
  const sleepCalls: number[] = [];
  const client = new OpenAiResponsesClient(transport, "fake-model", {
    timeoutMs: TIMEOUT_MS,
    maxAttempts: overrides?.maxAttempts,
    sleep: async (ms: number) => {
      sleepCalls.push(ms);
    },
  });
  return { client, sleepCalls };
}

describe("OpenAiResponsesClient", () => {
  it("1. success 1回 → retryなし", async () => {
    const transport = new FakeOpenAiResponsesTransport([successResult()]);
    const { client, sleepCalls } = buildClient(transport);

    const outcome = await client.fetch(DESCRIPTOR);

    expect(outcome.ok).toBe(true);
    expect(transport.callTimes).toBe(1);
    expect(sleepCalls).toHaveLength(0);
  });

  it("2. timeout → retry → success", async () => {
    const transport = new FakeOpenAiResponsesTransport([timeoutResult(), successResult()]);
    const { client, sleepCalls } = buildClient(transport);

    const outcome = await client.fetch(DESCRIPTOR);

    expect(outcome.ok).toBe(true);
    expect(transport.callTimes).toBe(2);
    expect(sleepCalls).toHaveLength(1);
  });

  it("3. 429 → retry → success", async () => {
    const transport = new FakeOpenAiResponsesTransport([rateLimitedResult(), successResult()]);
    const { client, sleepCalls } = buildClient(transport);

    const outcome = await client.fetch(DESCRIPTOR);

    expect(outcome.ok).toBe(true);
    expect(transport.callTimes).toBe(2);
    expect(sleepCalls).toHaveLength(1);
  });

  it("4. 5xx → retry → success", async () => {
    const transport = new FakeOpenAiResponsesTransport([serverErrorResult(500), successResult()]);
    const { client, sleepCalls } = buildClient(transport);

    const outcome = await client.fetch(DESCRIPTOR);

    expect(outcome.ok).toBe(true);
    expect(transport.callTimes).toBe(2);
    expect(sleepCalls).toHaveLength(1);
  });

  /**
   * 2026-09-08の修正: 「retryableかどうか」と「最終的なreason」は別軸(ユーザー指示)。
   * 以前は5xx/network_errorの最終reasonを"timeout"に寄せていたが、実際にtimeoutして
   * いない失敗をtimeoutと記録するのは事実に反するため、reasonは"fetch_failed"へ
   * 修正した(retryable自体は引き続きtrueのまま。既存canonical語彙は増やしていない)。
   */
  it("5. timeout retry exhaustion → failure outcome(reason='timeout')", async () => {
    const transport = new FakeOpenAiResponsesTransport([
      timeoutResult(),
      timeoutResult(),
      timeoutResult(),
    ]);
    const { client, sleepCalls } = buildClient(transport);

    const outcome = await client.fetch(DESCRIPTOR);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe("timeout");
    }
    expect(transport.callTimes).toBe(DEFAULT_MAX_ATTEMPTS);
    expect(sleepCalls).toHaveLength(DEFAULT_MAX_ATTEMPTS - 1);
  });

  it("5b. 429 retry exhaustion → failure outcome(reason='rate_limited'、retryable)", async () => {
    const transport = new FakeOpenAiResponsesTransport([
      rateLimitedResult(),
      rateLimitedResult(),
      rateLimitedResult(),
    ]);
    const { client, sleepCalls } = buildClient(transport);

    const outcome = await client.fetch(DESCRIPTOR);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe("rate_limited");
    }
    expect(transport.callTimes).toBe(DEFAULT_MAX_ATTEMPTS);
    expect(sleepCalls).toHaveLength(DEFAULT_MAX_ATTEMPTS - 1);
  });

  it("5c. network_error retry exhaustion → failure outcome(reason='fetch_failed'、retryable。timeoutではないため'timeout'にしない)", async () => {
    const transport = new FakeOpenAiResponsesTransport([
      networkErrorResult(),
      networkErrorResult(),
      networkErrorResult(),
    ]);
    const { client, sleepCalls } = buildClient(transport);

    const outcome = await client.fetch(DESCRIPTOR);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe("fetch_failed");
    }
    // retryableであること(1回で打ち切られていないこと)を試行回数で確認する
    expect(transport.callTimes).toBe(DEFAULT_MAX_ATTEMPTS);
    expect(sleepCalls).toHaveLength(DEFAULT_MAX_ATTEMPTS - 1);
  });

  it("5d. 5xx retry exhaustion → failure outcome(reason='fetch_failed'、retryable。timeoutではないため'timeout'にしない)", async () => {
    const transport = new FakeOpenAiResponsesTransport([
      serverErrorResult(500),
      serverErrorResult(503),
      serverErrorResult(500),
    ]);
    const { client, sleepCalls } = buildClient(transport);

    const outcome = await client.fetch(DESCRIPTOR);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe("fetch_failed");
    }
    // retryableであること(1回で打ち切られていないこと)を試行回数で確認する
    expect(transport.callTimes).toBe(DEFAULT_MAX_ATTEMPTS);
    expect(sleepCalls).toHaveLength(DEFAULT_MAX_ATTEMPTS - 1);
  });

  it("6. 401/403 → retryしない(reason='fetch_failed'、既存canonical語彙のまま)", async () => {
    const transport401 = new FakeOpenAiResponsesTransport([authFailureResult(401), successResult()]);
    const { client: client401, sleepCalls: sleep401 } = buildClient(transport401);
    const outcome401 = await client401.fetch(DESCRIPTOR);
    expect(outcome401.ok).toBe(false);
    if (!outcome401.ok) {
      expect(outcome401.reason).toBe("fetch_failed");
    }
    expect(transport401.callTimes).toBe(1);
    expect(sleep401).toHaveLength(0);

    const transport403 = new FakeOpenAiResponsesTransport([authFailureResult(403), successResult()]);
    const { client: client403, sleepCalls: sleep403 } = buildClient(transport403);
    const outcome403 = await client403.fetch(DESCRIPTOR);
    expect(outcome403.ok).toBe(false);
    if (!outcome403.ok) {
      expect(outcome403.reason).toBe("fetch_failed");
    }
    expect(transport403.callTimes).toBe(1);
    expect(sleep403).toHaveLength(0);
  });

  it("6b. malformed response → retryしない(reason='fetch_failed')", async () => {
    const transport = new FakeOpenAiResponsesTransport([
      malformedResponseResult(),
      successResult(),
    ]);
    const { client, sleepCalls } = buildClient(transport);

    const outcome = await client.fetch(DESCRIPTOR);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe("fetch_failed");
    }
    expect(transport.callTimes).toBe(1);
    expect(sleepCalls).toHaveLength(0);
  });

  it("7. maxAttemptsを超えない(全て失敗する場合、指定したmaxAttempts回で打ち切る)", async () => {
    const transport = new FakeOpenAiResponsesTransport([
      rateLimitedResult(),
      rateLimitedResult(),
      rateLimitedResult(),
      rateLimitedResult(),
      rateLimitedResult(),
    ]);
    const { client } = buildClient(transport, { maxAttempts: 4 });

    const outcome = await client.fetch(DESCRIPTOR);

    expect(outcome.ok).toBe(false);
    expect(transport.callTimes).toBe(4);
  });

  it("8. injected sleepが期待回数呼ばれる(試行間のみ。最後の試行後は呼ばれない)", async () => {
    const transport = new FakeOpenAiResponsesTransport([
      timeoutResult(),
      timeoutResult(),
      timeoutResult(),
    ]);
    const { client, sleepCalls } = buildClient(transport, { maxAttempts: 3 });

    await client.fetch(DESCRIPTOR);

    expect(sleepCalls).toHaveLength(2);
    expect(sleepCalls.every((ms) => ms > 0)).toBe(true);
  });

  it("9. requested modelを保持する(全試行で一貫して同じmodelがtransportへ渡る)", async () => {
    const transport = new FakeOpenAiResponsesTransport([timeoutResult(), successResult()]);
    const client = new OpenAiResponsesClient(transport, "gpt-fake-measurement-model", {
      timeoutMs: TIMEOUT_MS,
      sleep: async () => {},
    });

    await client.fetch(DESCRIPTOR);

    expect(transport.receivedRequests).toHaveLength(2);
    for (const req of transport.receivedRequests) {
      expect(req.requestedModel).toBe("gpt-fake-measurement-model");
    }
  });

  it("10. resultにraw secret/API keyという概念を一切含めない(Phase 1はAPI key自体を扱わない)", async () => {
    const transport = new FakeOpenAiResponsesTransport([successResult()]);
    const { client } = buildClient(transport);

    const outcome = await client.fetch(DESCRIPTOR);

    const serialized = JSON.stringify(outcome);
    expect(serialized.toLowerCase()).not.toContain("apikey");
    expect(serialized.toLowerCase()).not.toContain("api_key");
    expect(serialized.toLowerCase()).not.toContain("secret");
    // OpenAiResponsesClientOptions/OpenAiTransportRequestのいずれの型にも
    // API key相当のフィールドが存在しないこと自体が設計上の保証であり、
    // ここではoutcome(戻り値)にそのような値が紛れ込んでいないことを確認する。
  });
});
