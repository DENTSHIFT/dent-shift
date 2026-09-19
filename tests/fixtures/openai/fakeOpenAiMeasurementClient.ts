import type { OpenAiFetchOutcome } from "@/server/providers/ai/openai/openAiResponseTypes";
import type { OpenAiRequestDescriptor } from "@/server/providers/ai-measurement/openai/openAiRequestDescriptor";
import type { OpenAiMeasurementClient } from "@/server/providers/ai-measurement/openai/openAiMeasurementProvider";

/**
 * OpenAiMeasurementProvider用のfake client(2026-09-08のユーザー指示: Phase 2)。
 *
 * Phase 1の`FakeOpenAiResponsesTransport`(tests/fixtures/openai/
 * fakeOpenAiResponsesTransport.ts)はcall順でscriptされたfakeであり、
 * `OpenAiMeasurementProvider.observe()`が対象質問を`Promise.all()`で並列実行する
 * ため、複数質問が同時に発行されるとどのcallがどの質問に対応するか呼び出し順に
 * 依存してしまい非決定的になる(1問がリトライで複数回callする場合は特に顕著)。
 * そのため、この専用fakeはcall順ではなく`descriptor.userQuestion`(質問文字列)を
 * keyとしてscriptする、決定的な設計にする。
 */
export class FakeOpenAiMeasurementClient implements OpenAiMeasurementClient {
  public readonly receivedDescriptors: OpenAiRequestDescriptor[] = [];
  private readonly callCounts = new Map<string, number>();

  constructor(private readonly outcomesByQuestion: Record<string, OpenAiFetchOutcome>) {}

  async fetch(descriptor: OpenAiRequestDescriptor): Promise<OpenAiFetchOutcome> {
    this.receivedDescriptors.push(descriptor);
    const question = descriptor.userQuestion;
    this.callCounts.set(question, (this.callCounts.get(question) ?? 0) + 1);

    const outcome = this.outcomesByQuestion[question];
    if (!outcome) {
      throw new Error(
        `FakeOpenAiMeasurementClient: no scripted OpenAiFetchOutcome for question '${question}' ` +
          "(test setup bug: every question the provider is expected to call must have a scripted outcome)"
      );
    }
    return outcome;
  }

  callCountFor(question: string): number {
    return this.callCounts.get(question) ?? 0;
  }
}

interface FakeSuccessOverrides {
  id?: string;
  model?: string;
  text?: string;
  citations?: string[];
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
}

let fakeIdCounter = 0;
function nextFakeId(prefix: string): string {
  fakeIdCounter += 1;
  return `${prefix}_${fakeIdCounter}`;
}

/**
 * measurementStatus="measured"(web_search_callが実発生した)相当のOpenAiFetchOutcomeを
 * 構築する。テキストにclinic名を含めたい場合はoverrides.textで明示的に指定する
 * (post-hoc matchingはadapter側の責務であり、このfixtureはresponseの形だけを組み立てる)。
 */
export function measuredOutcome(overrides: FakeSuccessOverrides = {}): OpenAiFetchOutcome {
  return {
    ok: true,
    response: {
      id: overrides.id ?? nextFakeId("resp_measured_fake"),
      model: overrides.model ?? "fake-openai-model",
      output: [
        {
          type: "web_search_call",
          id: nextFakeId("ws_fake"),
          status: "completed",
          action: { type: "search", query: "fake measured query" },
        },
        {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: overrides.text ?? "テスト用のmeasured応答本文です。",
              annotations: (overrides.citations ?? []).map((url) => ({
                type: "url_citation" as const,
                url,
              })),
            },
          ],
        },
      ],
      usage: overrides.usage ?? { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
    },
  };
}

/**
 * measurementStatus="reference"(web_search_callが発生しなかった、検索なしの
 * モデル単独回答)相当のOpenAiFetchOutcomeを構築する。
 */
export function referenceOutcome(overrides: FakeSuccessOverrides = {}): OpenAiFetchOutcome {
  return {
    ok: true,
    response: {
      id: overrides.id ?? nextFakeId("resp_reference_fake"),
      model: overrides.model ?? "fake-openai-model",
      output: [
        {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: overrides.text ?? "テスト用のreference応答本文です(検索なし)。",
              annotations: (overrides.citations ?? []).map((url) => ({
                type: "url_citation" as const,
                url,
              })),
            },
          ],
        },
      ],
      usage: overrides.usage ?? { input_tokens: 5, output_tokens: 8, total_tokens: 13 },
    },
  };
}

/**
 * client層(OpenAiResponsesClient)がretryを使い切った後に返す最終失敗
 * (OpenAiFetchOutcome.ok===false)を直接構築する。このfixtureはclient層より
 * 手前の話(retry/timeout自体)は扱わない(Phase 1のFakeOpenAiResponsesTransport +
 * OpenAiResponsesClientの組み合わせでテスト済み)。
 */
export function failureOutcome(
  reason: "timeout" | "fetch_failed" | "rate_limited",
  message = "fake failure"
): OpenAiFetchOutcome {
  return { ok: false, reason, message };
}
