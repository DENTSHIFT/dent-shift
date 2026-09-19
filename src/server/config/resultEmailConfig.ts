import "server-only";

export interface DisabledResultEmailConfig {
  provider: "disabled";
}

export interface ResendResultEmailConfig {
  provider: "resend";
  apiKey: string;
  from: string;
  appBaseUrl: string;
}

export type ResultEmailConfig = DisabledResultEmailConfig | ResendResultEmailConfig;

export class ResultEmailConfigError extends Error {}

function resolveAppBaseUrl(rawValue: string): string {
  let url: URL;
  try {
    url = new URL(rawValue);
  } catch {
    throw new ResultEmailConfigError("APP_BASE_URL must be a valid absolute URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ResultEmailConfigError("APP_BASE_URL must use http or https.");
  }
  return url.origin;
}

/**
 * メール基盤は未確定のため既定値をdisabledとし、明示的にresendを選んだ場合だけ
 * 必須設定を検証する。API keyの値自体はエラー文へ一切含めない。
 */
export function resolveResultEmailConfig(options: {
  env: Record<string, string | undefined>;
}): ResultEmailConfig {
  const rawProvider = options.env.RESULT_EMAIL_PROVIDER?.trim() || "disabled";
  if (rawProvider === "disabled") return { provider: "disabled" };
  if (rawProvider !== "resend") {
    throw new ResultEmailConfigError(
      "RESULT_EMAIL_PROVIDER must be exactly 'disabled' or 'resend'."
    );
  }

  const apiKey = options.env.RESEND_API_KEY?.trim();
  const from = options.env.RESULT_EMAIL_FROM?.trim();
  const appBaseUrl = options.env.APP_BASE_URL?.trim();
  if (!apiKey) {
    throw new ResultEmailConfigError(
      "RESULT_EMAIL_PROVIDER='resend' requires RESEND_API_KEY."
    );
  }
  if (!from) {
    throw new ResultEmailConfigError(
      "RESULT_EMAIL_PROVIDER='resend' requires RESULT_EMAIL_FROM."
    );
  }
  if (!appBaseUrl) {
    throw new ResultEmailConfigError(
      "RESULT_EMAIL_PROVIDER='resend' requires APP_BASE_URL."
    );
  }

  return {
    provider: "resend",
    apiKey,
    from,
    appBaseUrl: resolveAppBaseUrl(appBaseUrl),
  };
}

export function resolveResultEmailConfigFromProcessEnv(): ResultEmailConfig {
  return resolveResultEmailConfig({ env: process.env });
}
