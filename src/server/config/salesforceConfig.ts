import "server-only";

export interface DisabledSalesforceConfig {
  provider: "disabled";
}

export interface SalesforceOAuthConfig {
  provider: "salesforce";
  clientId: string;
  clientSecret: string;
  // OAuth 2.0 username-password / client-credentials flowのトークンエンドポイント
  // (例: https://login.salesforce.com または https://test.salesforce.com のSandbox版)。
  loginUrl: string;
  // 接続先組織ID(15桁の比較)。トークン取得時に実際の組織と照合し、不一致なら一切書き込まない
  // (本番と開発・Sandboxの取り違え防止)。
  expectedOrgId: string;
}

export type SalesforceConfig = DisabledSalesforceConfig | SalesforceOAuthConfig;

export class SalesforceConfigError extends Error {}

/**
 * Salesforce契約・Connected App設定が未確定のため既定値をdisabledとする。
 * 指示書17章「資格情報をハードコードしない」「推測でAPI名を作らない」に従い、
 * 明示的にprovider="salesforce"を選んだ場合だけ必須設定を検証する。
 */
export function resolveSalesforceConfig(options: {
  env: Record<string, string | undefined>;
}): SalesforceConfig {
  const rawProvider = options.env.SALESFORCE_PROVIDER?.trim() || "disabled";
  if (rawProvider === "disabled") return { provider: "disabled" };
  if (rawProvider !== "salesforce") {
    throw new SalesforceConfigError(
      "SALESFORCE_PROVIDER must be exactly 'disabled' or 'salesforce'."
    );
  }

  const clientId = options.env.SALESFORCE_CLIENT_ID?.trim();
  const clientSecret = options.env.SALESFORCE_CLIENT_SECRET?.trim();
  const loginUrl = options.env.SALESFORCE_LOGIN_URL?.trim();

  if (!clientId) {
    throw new SalesforceConfigError(
      "SALESFORCE_PROVIDER='salesforce' requires SALESFORCE_CLIENT_ID."
    );
  }
  if (!clientSecret) {
    throw new SalesforceConfigError(
      "SALESFORCE_PROVIDER='salesforce' requires SALESFORCE_CLIENT_SECRET."
    );
  }
  if (!loginUrl) {
    throw new SalesforceConfigError(
      "SALESFORCE_PROVIDER='salesforce' requires SALESFORCE_LOGIN_URL."
    );
  }
  const expectedOrgId = options.env.SALESFORCE_EXPECTED_ORG_ID?.trim();
  if (!expectedOrgId || !/^00D[0-9A-Za-z]{12}([0-9A-Za-z]{3})?$/.test(expectedOrgId)) {
    throw new SalesforceConfigError(
      "SALESFORCE_PROVIDER='salesforce' requires SALESFORCE_EXPECTED_ORG_ID (15 or 18 character org ID starting with 00D)."
    );
  }

  let parsedLoginUrl: URL;
  try {
    parsedLoginUrl = new URL(loginUrl);
  } catch {
    throw new SalesforceConfigError("SALESFORCE_LOGIN_URL must be a valid absolute URL.");
  }
  if (parsedLoginUrl.protocol !== "https:") {
    throw new SalesforceConfigError("SALESFORCE_LOGIN_URL must use https.");
  }

  return {
    provider: "salesforce",
    clientId,
    clientSecret,
    loginUrl: parsedLoginUrl.origin,
    expectedOrgId: expectedOrgId.slice(0, 15),
  };
}

export function resolveSalesforceConfigFromProcessEnv(): SalesforceConfig {
  return resolveSalesforceConfig({ env: process.env });
}
