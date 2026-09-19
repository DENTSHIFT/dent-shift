import { describe, expect, it } from "vitest";
import {
  resolveAiMeasurementConfig,
  AiMeasurementConfigError,
  DEFAULT_OPENAI_TIMEOUT_MS,
  DEFAULT_OPENAI_MAX_ATTEMPTS,
} from "@/server/config/aiMeasurementConfig";

/**
 * aiMeasurementConfig.ts(Phase 3、2026-09-08のユーザー指示)のテスト。
 * process.envではなく`resolveAiMeasurementConfig({env})`へ直接envオブジェクトを
 * 注入してテストする(純粋関数のため、実環境変数を汚さない)。
 * 番号コメントはユーザー指示の必須test項目16〜22、28、29に対応する。
 */

describe("aiMeasurementConfig", () => {
  it("16. provider='mock'の場合、{provider:'mock'}を返す", () => {
    const config = resolveAiMeasurementConfig({ env: { AI_MEASUREMENT_PROVIDER: "mock" } });
    expect(config).toEqual({ provider: "mock" });
  });

  it("17. provider='openai' + apiKey/modelありの場合、正規化された設定を返す", () => {
    const config = resolveAiMeasurementConfig({
      env: {
        AI_MEASUREMENT_PROVIDER: "openai",
        OPENAI_API_KEY: "sk-test-key",
        OPENAI_AI_MEASUREMENT_MODEL: "gpt-test-model",
      },
    });
    expect(config).toEqual({
      provider: "openai",
      apiKey: "sk-test-key",
      model: "gpt-test-model",
      timeoutMs: DEFAULT_OPENAI_TIMEOUT_MS,
      maxAttempts: DEFAULT_OPENAI_MAX_ATTEMPTS,
    });
  });

  it("18. AI_MEASUREMENT_PROVIDER未設定→AiMeasurementConfigErrorをthrowする", () => {
    expect(() => resolveAiMeasurementConfig({ env: {} })).toThrow(AiMeasurementConfigError);
  });

  it("19. AI_MEASUREMENT_PROVIDERが不正値('chatgpt'等)→AiMeasurementConfigErrorをthrowする", () => {
    expect(() =>
      resolveAiMeasurementConfig({ env: { AI_MEASUREMENT_PROVIDER: "chatgpt" } })
    ).toThrow(AiMeasurementConfigError);
  });

  it("20. provider='openai'なのにOPENAI_API_KEY未設定→AiMeasurementConfigErrorをthrowする", () => {
    expect(() =>
      resolveAiMeasurementConfig({
        env: { AI_MEASUREMENT_PROVIDER: "openai", OPENAI_AI_MEASUREMENT_MODEL: "gpt-test-model" },
      })
    ).toThrow(AiMeasurementConfigError);
  });

  it("21. provider='openai'なのにOPENAI_AI_MEASUREMENT_MODEL未設定→AiMeasurementConfigErrorをthrowする", () => {
    expect(() =>
      resolveAiMeasurementConfig({
        env: { AI_MEASUREMENT_PROVIDER: "openai", OPENAI_API_KEY: "sk-test-key" },
      })
    ).toThrow(AiMeasurementConfigError);
  });

  it("22. provider='mock'の場合、OpenAI関連envが一切無くてもerrorにならない", () => {
    expect(() =>
      resolveAiMeasurementConfig({ env: { AI_MEASUREMENT_PROVIDER: "mock" } })
    ).not.toThrow();
  });

  it("28. NEXT_PUBLIC_プレフィックスのOpenAI key envは読まない(OPENAI_API_KEY未設定のまま扱われる)", () => {
    // NEXT_PUBLIC_OPENAI_API_KEYが設定されていても、resolverはOPENAI_API_KEYしか
    // 見ないため、正規のOPENAI_API_KEYが無ければ引き続きerrorになることを確認する
    // (=NEXT_PUBLIC_変種をfallback的に読んでいないことの証明)。
    expect(() =>
      resolveAiMeasurementConfig({
        env: {
          AI_MEASUREMENT_PROVIDER: "openai",
          NEXT_PUBLIC_OPENAI_API_KEY: "sk-should-not-be-read",
          OPENAI_AI_MEASUREMENT_MODEL: "gpt-test-model",
        },
      })
    ).toThrow(AiMeasurementConfigError);
  });

  it("29. config errorのmessageにAPI key文字列が含まれない", () => {
    const fakeKey = "sk-should-never-leak-1234567890";
    let caught: unknown;
    try {
      resolveAiMeasurementConfig({
        env: { AI_MEASUREMENT_PROVIDER: "openai", OPENAI_API_KEY: fakeKey },
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AiMeasurementConfigError);
    expect((caught as Error).message).not.toContain(fakeKey);
  });
});
