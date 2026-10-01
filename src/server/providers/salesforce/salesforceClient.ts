import "server-only";
import type { SalesforceOAuthConfig } from "@/server/config/salesforceConfig";

const API_VERSION = "v60.0";
const REQUEST_TIMEOUT_MS = 10_000;
// Salesforceのセッション既定有効期限(2時間)より十分短く保持し、401時は即時再取得する。
const TOKEN_TTL_MS = 20 * 60 * 1000;

export class SalesforceDeliveryError extends Error {
  constructor(
    message: string,
    readonly errorCode: string | null = null
  ) {
    super(message);
  }
}

interface SalesforceAccessToken {
  accessToken: string;
  instanceUrl: string;
  expiresAt: number;
}

export const ORG_MISMATCH_ERROR_CODE = "DENT_SHIFT_ORG_MISMATCH";
export const OAUTH_ERROR_CODE = "DENT_SHIFT_OAUTH_FAILED";

let cachedToken: (SalesforceAccessToken & { cacheKey: string }) | null = null;

export function clearSalesforceTokenCacheForTests(): void {
  cachedToken = null;
}

/**
 * OAuth 2.0 Client Credentials Flowでアクセストークンを取得する。
 * 同一インスタンス内ではTTLの間キャッシュし、イベントごとのトークン再発行を避ける。
 */
async function getAccessToken(config: SalesforceOAuthConfig, forceRefresh = false): Promise<SalesforceAccessToken> {
  const cacheKey = `${config.loginUrl}|${config.clientId}`;
  if (!forceRefresh && cachedToken && cachedToken.cacheKey === cacheKey && cachedToken.expiresAt > Date.now()) {
    return cachedToken;
  }

  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });

  let response: Response;
  try {
    response = await fetch(`${config.loginUrl}/services/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new SalesforceDeliveryError("Salesforce OAuth token request failed.", OAUTH_ERROR_CODE);
  }

  if (!response.ok) {
    throw new SalesforceDeliveryError(`Salesforce OAuth token request returned HTTP ${response.status}.`, OAUTH_ERROR_CODE);
  }

  const body = (await response.json()) as { access_token?: string; instance_url?: string; id?: string };
  if (!body.access_token || !body.instance_url) {
    throw new SalesforceDeliveryError("Salesforce OAuth token response was malformed.", OAUTH_ERROR_CODE);
  }
  // トークン応答のid(https://<login>/id/<組織ID>/<ユーザーID>)から実際の接続先組織を確認する。
  const orgId = typeof body.id === "string" ? body.id.split("/id/")[1]?.split("/")[0] ?? "" : "";
  if (orgId.slice(0, 15) !== config.expectedOrgId.slice(0, 15)) {
    throw new SalesforceDeliveryError(
      "Salesforce org does not match SALESFORCE_EXPECTED_ORG_ID; refusing to sync.",
      ORG_MISMATCH_ERROR_CODE
    );
  }
  cachedToken = {
    cacheKey,
    accessToken: body.access_token,
    instanceUrl: body.instance_url,
    expiresAt: Date.now() + TOKEN_TTL_MS,
  };
  return cachedToken;
}

// Salesforceのエラー応答([{ errorCode, message, fields }])からerrorCodeと項目名だけを取り出す。
// messageには送信値が含まれ得るため、例外・ログへは含めない。
async function readErrorSummary(response: Response): Promise<{ errorCode: string | null; fields: string[] }> {
  try {
    const body = (await response.json()) as unknown;
    const first = Array.isArray(body) ? (body[0] as { errorCode?: unknown; fields?: unknown }) : null;
    return {
      errorCode: typeof first?.errorCode === "string" ? first.errorCode : null,
      fields: Array.isArray(first?.fields) ? first.fields.filter((f): f is string => typeof f === "string") : [],
    };
  } catch {
    return { errorCode: null, fields: [] };
  }
}

// 認証付きでREST APIを呼ぶ。401(トークン失効)なら1回だけトークンを再取得して再送する。
async function requestSalesforce(
  config: SalesforceOAuthConfig,
  method: "GET" | "PATCH",
  path: string,
  label: string,
  body?: Record<string, unknown>
): Promise<Response> {
  const send = async (token: SalesforceAccessToken) => {
    try {
      return await fetch(`${token.instanceUrl}/services/data/${API_VERSION}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new SalesforceDeliveryError(`Salesforce ${label} request failed.`);
    }
  };
  let response = await send(await getAccessToken(config));
  if (response.status === 401) {
    response = await send(await getAccessToken(config, true));
  }
  return response;
}

async function throwForResponse(response: Response, label: string): Promise<never> {
  const summary = await readErrorSummary(response);
  const fieldsNote = summary.fields.length ? ` fields=${summary.fields.join(",")}` : "";
  throw new SalesforceDeliveryError(
    `Salesforce ${label} returned HTTP ${response.status}${summary.errorCode ? ` ${summary.errorCode}` : ""}${fieldsNote}.`,
    summary.errorCode
  );
}

function sobjectPath(sobject: string, ...segments: string[]): string {
  return `/sobjects/${sobject}/${segments.map((segment) => encodeURIComponent(segment)).join("/")}`;
}

export interface SalesforceUpsertResult {
  id: string;
  created: boolean;
}

/**
 * 外部ID項目をキーにレコードを作成または更新する(Salesforce REST upsert)。
 * 同じ外部IDでの再送(再診断・Webhook再送・再試行)は常に同じ1件の更新になり、重複作成しない。
 */
export async function upsertSalesforceRecordByExternalId(input: {
  config: SalesforceOAuthConfig;
  sobject: string;
  externalIdField: string;
  externalId: string;
  fields: Record<string, unknown>;
}): Promise<SalesforceUpsertResult> {
  const label = `${input.sobject} upsert`;
  const response = await requestSalesforce(
    input.config,
    "PATCH",
    sobjectPath(input.sobject, input.externalIdField, input.externalId),
    label,
    input.fields
  );
  if (!response.ok) await throwForResponse(response, label);

  if (response.status === 204) {
    // 古いAPIバージョンの更新応答(本文なし)。IDは返らないが更新は成功している。
    return { id: "", created: false };
  }
  const body = (await response.json().catch(() => ({}))) as { id?: unknown; created?: unknown };
  if (typeof body.id !== "string") {
    throw new SalesforceDeliveryError(`Salesforce ${input.sobject} upsert response was malformed.`);
  }
  return { id: body.id, created: response.status === 201 || body.created === true };
}

export type SalesforceRecord = Record<string, unknown> & { Id: string };

async function readRecord(response: Response, label: string): Promise<SalesforceRecord | null> {
  if (response.status === 404) return null;
  if (!response.ok) await throwForResponse(response, label);
  const body = (await response.json().catch(() => null)) as { Id?: unknown } | null;
  if (!body || typeof body.Id !== "string") {
    throw new SalesforceDeliveryError(`Salesforce ${label} response was malformed.`);
  }
  return body as SalesforceRecord;
}

/** 外部IDでレコードを1件読む(存在しなければnull)。読む項目は呼び出し側で限定する。 */
export async function getSalesforceRecordByExternalId(input: {
  config: SalesforceOAuthConfig;
  sobject: string;
  externalIdField: string;
  externalId: string;
  fields: string[];
}): Promise<SalesforceRecord | null> {
  const label = `${input.sobject} read`;
  const query = `?fields=${encodeURIComponent(["Id", ...input.fields].join(","))}`;
  const response = await requestSalesforce(
    input.config,
    "GET",
    `${sobjectPath(input.sobject, input.externalIdField, input.externalId)}${query}`,
    label
  );
  return readRecord(response, label);
}

/** Salesforce IDでレコードを1件読む(存在しなければnull)。 */
export async function getSalesforceRecordById(input: {
  config: SalesforceOAuthConfig;
  sobject: string;
  id: string;
  fields: string[];
}): Promise<SalesforceRecord | null> {
  const label = `${input.sobject} read`;
  const query = `?fields=${encodeURIComponent(["Id", ...input.fields].join(","))}`;
  const response = await requestSalesforce(input.config, "GET", `${sobjectPath(input.sobject, input.id)}${query}`, label);
  return readRecord(response, label);
}

/** Salesforce IDを指定して既存レコードの項目を更新する(作成はしない)。 */
export async function updateSalesforceRecordById(input: {
  config: SalesforceOAuthConfig;
  sobject: string;
  id: string;
  fields: Record<string, unknown>;
}): Promise<void> {
  const label = `${input.sobject} update`;
  const response = await requestSalesforce(input.config, "PATCH", sobjectPath(input.sobject, input.id), label, input.fields);
  if (!response.ok) await throwForResponse(response, label);
}
