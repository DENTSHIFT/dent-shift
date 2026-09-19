import "server-only";

/**
 * AI計測provider設定のresolver(Phase 3、2026-09-08のユーザー指示)。
 *
 * route.ts(composition root)がprocess.envを直接散らして読むことを避けるため、
 * env値を読んで正規化された設定値へ変換する処理をこの1ファイルへ閉じ込める。
 * 純粋関数として実装し(`resolveAiMeasurementConfig`)、`process.env`への実際の
 * アクセスは`resolveAiMeasurementConfigFromProcessEnv`という薄いwrapperのみに
 * 限定する(unit testでは`resolveAiMeasurementConfig`へ任意のenvオブジェクトを
 * 注入してテストできる)。
 *
 * 【最重要原則(2026-09-08のユーザー指示)】
 * - AI_MEASUREMENT_PROVIDERは"mock"|"openai"のみ許可。未設定→error、不正値→error。
 *   envの有無だけでmock/openaiを自動判定するsilent fallbackは一切行わない。
 * - provider="openai"の場合、OPENAI_API_KEY / OPENAI_AI_MEASUREMENT_MODELの
 *   いずれかが欠落していても明示error(silent mock fallbackしない)。
 * - エラーメッセージにAPI key文字列そのものを含めない。
 */

export type AiMeasurementProviderKind = "mock" | "openai";

export interface MockAiMeasurementConfig {
  provider: "mock";
}

export interface OpenAiMeasurementConfig {
  provider: "openai";
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxAttempts: number;
}

export type AiMeasurementConfig = MockAiMeasurementConfig | OpenAiMeasurementConfig;

/** 設定不備(未設定・不正値・必須値欠落)を表すエラー。silent補正は一切行わず、
 *  必ずこのエラーをthrowする。 */
export class AiMeasurementConfigError extends Error {}

/**
 * P0推奨default(2026-09-08のユーザー指示のPhase 3ラウンドで確定)。
 *
 * 「無料60秒AI集患診断」というproduct全体の時間予算(src/app/diagnosis/page.tsxの
 * ANALYZING_DURATION_MS=12000は最低表示時間であり、実処理がそれより長ければ
 * 実処理完了まで待つ設計)を踏まえて検討した。対象質問はOpenAiMeasurementProvider内で
 * Promise.allにより並列実行されるため、直列に積み上がるのは「1問あたりのworst
 * case」だけであり、これがcanonical measurement全体のworst caseそのものになる。
 *
 * - timeoutMs=20000 × maxAttempts=3(初回+retry2回)の場合:
 *   worst case ≈ 20000×3 + backoff(500+1000) = 61500ms(約61.5秒)。
 *   これは「無料60秒診断」という製品の時間予算全体を、この1つのoverlay計測だけで
 *   使い切ってしまう(超過すらしうる)ため、P0のdefaultとしては採用しない。
 * - timeoutMs=15000 × maxAttempts=2(初回+retry1回)の場合:
 *   worst case ≈ 15000×2 + backoff(500) = 30500ms(約30.5秒)。
 *   典型ケース(API正常応答)への影響はなく、worst caseでも診断全体の時間予算の
 *   半分程度に収まるため、こちらをP0推奨defaultとして採用する。
 *
 * 「retry 2回 = maxAttempts 3」等の表現混同を避けるため、ここでは初回を含めた
 * 総試行回数(maxAttempts)で統一する(Phase 1のOpenAiResponsesClientOptionsと同じ
 * 語彙)。将来、実際の応答時間分布を計測したうえで見直す余地がある(N節参照)。
 */
export const DEFAULT_OPENAI_TIMEOUT_MS = 15000;
export const DEFAULT_OPENAI_MAX_ATTEMPTS = 2;

export interface ResolveAiMeasurementConfigOptions {
  /** テスト容易性のため、process.envではなく任意のenvオブジェクトを受け取る。 */
  env: Record<string, string | undefined>;
}

/**
 * env値からAiMeasurementConfigを解決する純粋関数。DB/ネットワーク等の副作用は
 * 一切持たない。不備があれば必ずAiMeasurementConfigErrorをthrowする(値を
 * 黙って補正・mockへfallbackすることはしない)。
 */
export function resolveAiMeasurementConfig(
  options: ResolveAiMeasurementConfigOptions
): AiMeasurementConfig {
  const { env } = options;
  const rawProvider = env.AI_MEASUREMENT_PROVIDER;

  if (rawProvider === undefined || rawProvider.trim().length === 0) {
    throw new AiMeasurementConfigError(
      "AI_MEASUREMENT_PROVIDER is not set. It must be explicitly set to 'mock' or 'openai' " +
        "(silent mock fallback is not allowed)."
    );
  }

  if (rawProvider !== "mock" && rawProvider !== "openai") {
    throw new AiMeasurementConfigError(
      `AI_MEASUREMENT_PROVIDER has an invalid value: '${rawProvider}'. ` +
        "It must be exactly 'mock' or 'openai'."
    );
  }

  if (rawProvider === "mock") {
    // 2026-09-08のユーザー指示: mock modeではOpenAI関連envは不要(未設定でもよい)。
    return { provider: "mock" };
  }

  // rawProvider === "openai"
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey || apiKey.trim().length === 0) {
    throw new AiMeasurementConfigError(
      "AI_MEASUREMENT_PROVIDER='openai' requires OPENAI_API_KEY to be set."
      // 2026-09-08のユーザー指示: API key文字列自体はエラーメッセージへ含めない。
    );
  }

  const model = env.OPENAI_AI_MEASUREMENT_MODEL;
  if (!model || model.trim().length === 0) {
    throw new AiMeasurementConfigError(
      "AI_MEASUREMENT_PROVIDER='openai' requires OPENAI_AI_MEASUREMENT_MODEL to be set."
    );
  }

  return {
    provider: "openai",
    apiKey,
    model,
    timeoutMs: DEFAULT_OPENAI_TIMEOUT_MS,
    maxAttempts: DEFAULT_OPENAI_MAX_ATTEMPTS,
  };
}

/**
 * production composition root(route.ts)用のconvenience wrapper。
 * process.envへ直接アクセスする箇所をこの1関数だけに閉じ込める
 * (2026-09-08のユーザー指示: route.tsでprocess.envを直接散らして読まない)。
 */
export function resolveAiMeasurementConfigFromProcessEnv(): AiMeasurementConfig {
  return resolveAiMeasurementConfig({ env: process.env });
}
