import "server-only";

export interface DisabledLineWorksConfig {
  provider: "disabled";
}

export interface EnabledLineWorksConfig {
  provider: "lineworks";
  clientId: string;
  clientSecret: string;
  serviceAccount: string;
  privateKey: string;
  botId: string;
  botSecret: string;
}

export type LineWorksConfig = DisabledLineWorksConfig | EnabledLineWorksConfig;

export class LineWorksConfigError extends Error {}

/**
 * LINE WORKSは仕様書Ver3.3(2026-09-21)により顧客コミュニケーション基盤として
 * 導入前提だが、API・認証情報は開通待ち(約3営業日)のため未確定。
 * 契約情報が揃うまでは既定値をdisabledとし、provider="lineworks"を明示選択した
 * 場合だけ必須設定を検証する(salesforceConfig.ts/smsConfig.tsと同じパターン)。
 * ダミー認証情報を本番コードへ直接埋め込まない(仕様書11章の実装原則)。
 */
export function resolveLineWorksConfig(options: {
  env: Record<string, string | undefined>;
}): LineWorksConfig {
  const rawProvider = options.env.LINE_WORKS_PROVIDER?.trim() || "disabled";
  if (rawProvider === "disabled") return { provider: "disabled" };
  if (rawProvider !== "lineworks") {
    throw new LineWorksConfigError("LINE_WORKS_PROVIDER must be exactly 'disabled' or 'lineworks'.");
  }

  const clientId = options.env.LINE_WORKS_CLIENT_ID?.trim();
  const clientSecret = options.env.LINE_WORKS_CLIENT_SECRET?.trim();
  const serviceAccount = options.env.LINE_WORKS_SERVICE_ACCOUNT?.trim();
  const privateKey = options.env.LINE_WORKS_PRIVATE_KEY?.trim();
  const botId = options.env.LINE_WORKS_BOT_ID?.trim();
  const botSecret = options.env.LINE_WORKS_BOT_SECRET?.trim();

  if (!clientId) {
    throw new LineWorksConfigError("LINE_WORKS_PROVIDER='lineworks' requires LINE_WORKS_CLIENT_ID.");
  }
  if (!clientSecret) {
    throw new LineWorksConfigError("LINE_WORKS_PROVIDER='lineworks' requires LINE_WORKS_CLIENT_SECRET.");
  }
  if (!serviceAccount) {
    throw new LineWorksConfigError("LINE_WORKS_PROVIDER='lineworks' requires LINE_WORKS_SERVICE_ACCOUNT.");
  }
  if (!privateKey) {
    throw new LineWorksConfigError("LINE_WORKS_PROVIDER='lineworks' requires LINE_WORKS_PRIVATE_KEY.");
  }
  if (!botId) {
    throw new LineWorksConfigError("LINE_WORKS_PROVIDER='lineworks' requires LINE_WORKS_BOT_ID.");
  }
  if (!botSecret) {
    throw new LineWorksConfigError("LINE_WORKS_PROVIDER='lineworks' requires LINE_WORKS_BOT_SECRET.");
  }

  return { provider: "lineworks", clientId, clientSecret, serviceAccount, privateKey, botId, botSecret };
}

export function resolveLineWorksConfigFromProcessEnv(): LineWorksConfig {
  return resolveLineWorksConfig({ env: process.env });
}
