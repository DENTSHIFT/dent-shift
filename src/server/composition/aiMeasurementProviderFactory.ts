import "server-only";
import type { AiMeasurementProvider } from "@/domain/ai-measurement/provider";
import type { AiMeasurementConfig } from "@/server/config/aiMeasurementConfig";
import { OpenAiSdkTransport } from "@/server/providers/ai-measurement/openai/openAiSdkTransport";
import { OpenAiResponsesClient } from "@/server/providers/ai-measurement/openai/openAiResponsesClient";
import { OpenAiMeasurementProvider } from "@/server/providers/ai-measurement/openai/openAiMeasurementProvider";
import type { OpenAiResponsesTransport } from "@/server/providers/ai-measurement/openai/openAiResponsesTransport";

/**
 * AiMeasurementConfigから実際に使うAiMeasurementProviderを構築するcomposition helper
 * (Phase 3、2026-09-08のユーザー指示: route.tsを薄く保つため、この関数へ切り出して
 * unit testできるようにする)。
 *
 * config.provider==="mock"の場合は`undefined`を返す(2026-09-08のユーザー指示の推奨:
 * mock modeではdeps.aiMeasurementProvider = undefinedとし、既存診断(legacy mock
 * aiProviderのみ)と完全一致させる。Phase 2のOpenAiMeasurementProviderへfake/mock
 * transportをproductionで注入することはしない)。
 *
 * config.provider==="openai"の場合、Phase 1/2で完成した
 * OpenAiSdkTransport → OpenAiResponsesClient → OpenAiMeasurementProvider
 * を配線して返す。ここでもcanonical業務判定・mock fallback判定は一切行わない
 * (すべて既存の各層に委譲する。このファイルは純粋な配線のみ)。
 */
export interface CreateAiMeasurementProviderOverrides {
  /** テスト用: 実SDK transport(OpenAiSdkTransport、実ネットワーク)の代わりに
   *  注入するfake transport。省略時のみ実際にOpenAiSdkTransportを構築する
   *  (production composition rootではこのoverridesを一切渡さない)。 */
  transport?: OpenAiResponsesTransport;
}

export function createAiMeasurementProviderFromConfig(
  config: AiMeasurementConfig,
  overrides: CreateAiMeasurementProviderOverrides = {}
): AiMeasurementProvider | undefined {
  if (config.provider === "mock") {
    return undefined;
  }

  const transport = overrides.transport ?? new OpenAiSdkTransport({ apiKey: config.apiKey });
  const client = new OpenAiResponsesClient(transport, config.model, {
    timeoutMs: config.timeoutMs,
    maxAttempts: config.maxAttempts,
  });
  return new OpenAiMeasurementProvider(config.model, client);
}
