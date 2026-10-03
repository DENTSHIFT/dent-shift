import "server-only";
import type { SalesforceOAuthConfig } from "@/server/config/salesforceConfig";

const API_VERSION = "v60.0";
const REQUEST_TIMEOUT_MS = 10_000;
// Salesforceのセッション既定有効期限(2時間)より十分短く保持し、401時は即時再取得する。
const TOKEN_TTL_MS = 20 * 60 * 1000;

// DUPLICATES_DETECTED応答に含まれる、検出された重複候補1件分(オブジェクト種別+ID)。
// 値(Email等の個人情報)は一切保持しない。SalesforceDeliveryError.duplicateCandidates
// がnullでない配列として返る場合、その中の各要素は必ずsobjectType・idとも
// 文字列で埋まっている(一部だけ読み取れた不完全な候補は配列に含めず、
// 応答全体をduplicateCandidates=nullとして扱う。詳細はsalesforceClient.tsの
// extractDuplicateCandidates()を参照)。
export interface SalesforceDuplicateCandidate {
  sobjectType: string | null;
  id: string | null;
}

export class SalesforceDeliveryError extends Error {
  constructor(
    message: string,
    readonly errorCode: string | null = null,
    // errorCode==="DUPLICATES_DETECTED"の場合のみ意味を持つ。それ以外は常にnull。
    readonly duplicateCandidates: ReadonlyArray<SalesforceDuplicateCandidate> | null = null
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
// Salesforce標準の重複ルールエラー(Setup側のアクションが「許可(Alert)」でも、
// REST/SOAP APIはSforce-Duplicate-Rule-Headerのallowsave=trueを明示しない限り
// デフォルト(false)でこのエラーを返す。UIの「このまま保存」ダイアログに相当する
// 確認をAPI側では省略できないための仕様。
// 出典: https://developer.salesforce.com/docs/platform/api-rest/guide/headers-duplicaterules.html
export const DUPLICATES_DETECTED_ERROR_CODE = "DUPLICATES_DETECTED";

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

// DUPLICATES_DETECTEDの応答本体から、検出された重複候補(オブジェクト種別+ID)だけを
// 取り出す。Salesforceの実際のキー名は"duplicateResult"だが、APIバージョンによっては
// "duplicateResut"という綴りで返ることが確認されているため両方を見る。項目の値
// (Email等)は一切読み取らない。
//
// 2026-10-04修正: 一部のmatchResult・matchRecord・candidateレコードだけ形式が
// 読み取れた場合に、読み取れなかった分を読み飛ばして「読み取れた候補だけ」を
// 返すと、呼び出し側が実際には存在する別の候補を見落としたまま保存許可して
// しまう恐れがある。そのため、構造のどこか1箇所でも期待した形式(配列・文字列の
// Id・文字列のsobjectType)と異なる場合は、読み取れた分を部分的に返さず、
// 応答全体を「候補情報が不足している」として呼び出し側へnullで伝える
// (読み飛ばしによる取りこぼしより、安全側に倒して再送を止めることを優先する)。
function extractDuplicateCandidates(first: unknown): SalesforceDuplicateCandidate[] | null {
  const container = first as { duplicateResult?: unknown; duplicateResut?: unknown } | null;
  const duplicateResult = container?.duplicateResult ?? container?.duplicateResut;
  if (duplicateResult === null || duplicateResult === undefined) return null;
  const matchResults = (duplicateResult as { matchResults?: unknown }).matchResults;
  if (!Array.isArray(matchResults) || matchResults.length === 0) return null;

  const candidates: SalesforceDuplicateCandidate[] = [];
  for (const matchResult of matchResults) {
    const matchRecords = (matchResult as { matchRecords?: unknown } | null)?.matchRecords;
    // matchRecordsが配列でない・空の場合、この照合結果の中身を読み取れない
    // (=候補が本当に0件なのか、構造が未知なだけなのか区別できない)ため、
    // 読み飛ばさず応答全体を情報不足として扱う。
    if (!Array.isArray(matchRecords) || matchRecords.length === 0) return null;
    for (const matchRecord of matchRecords) {
      const record = (matchRecord as { record?: unknown } | null)?.record as
        | { Id?: unknown; attributes?: { type?: unknown } }
        | undefined;
      const id = typeof record?.Id === "string" && record.Id ? record.Id : null;
      const sobjectType =
        typeof record?.attributes?.type === "string" && record.attributes.type ? record.attributes.type : null;
      // ID・種別のどちらかが欠けている(=形式不正)候補が1件でもあれば、
      // その候補だけ読み飛ばさず、応答全体を情報不足として扱う。
      if (id === null || sobjectType === null) return null;
      candidates.push({ sobjectType, id });
    }
  }
  return candidates.length > 0 ? candidates : null;
}

// Salesforceのエラー応答([{ errorCode, message, fields, duplicateResult? }])から
// errorCode・項目名・(あれば)重複候補の種別+IDだけを取り出す。messageや候補レコードの
// 項目値には送信値・個人情報が含まれ得るため、例外・ログへは一切含めない。
async function readErrorSummary(
  response: Response
): Promise<{ errorCode: string | null; fields: string[]; duplicateCandidates: SalesforceDuplicateCandidate[] | null }> {
  try {
    const body = (await response.json()) as unknown;
    const first = Array.isArray(body) ? (body[0] as { errorCode?: unknown; fields?: unknown }) : null;
    return {
      errorCode: typeof first?.errorCode === "string" ? first.errorCode : null,
      fields: Array.isArray(first?.fields) ? first.fields.filter((f): f is string => typeof f === "string") : [],
      duplicateCandidates: extractDuplicateCandidates(first),
    };
  } catch {
    return { errorCode: null, fields: [], duplicateCandidates: null };
  }
}

// 認証付きでREST APIを呼ぶ。401(トークン失効)なら1回だけトークンを再取得して再送する。
async function requestSalesforce(
  config: SalesforceOAuthConfig,
  method: "GET" | "PATCH",
  path: string,
  label: string,
  body?: Record<string, unknown>,
  options?: { allowDuplicateSave?: boolean; includeDuplicateRecordDetails?: boolean }
): Promise<Response> {
  const duplicateRuleHeaderParts: string[] = [];
  if (options?.allowDuplicateSave) duplicateRuleHeaderParts.push("allowSave=true");
  if (options?.includeDuplicateRecordDetails) duplicateRuleHeaderParts.push("includeRecordDetails=true");
  const send = async (token: SalesforceAccessToken) => {
    try {
      return await fetch(`${token.instanceUrl}/services/data/${API_VERSION}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
          // allowSave=trueは呼び出し側が個別に安全確認した場合だけ明示的に付与する
          // (既定では付けない=Setup側の重複ルール判定を常にそのまま尊重する)。
          // includeRecordDetails=trueは、失敗時に重複候補のオブジェクト種別/IDを
          // 読み取れるようにするためだけに使い、allowSaveの値には影響しない。
          ...(duplicateRuleHeaderParts.length > 0
            ? { "Sforce-Duplicate-Rule-Header": duplicateRuleHeaderParts.join("; ") }
            : {}),
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
    summary.errorCode,
    summary.duplicateCandidates
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
  // 2026-10-03追加(読み取り調査に基づく提案、承認待ち): 呼び出し側が重複候補を
  // 自分自身の関連レコードだと確認できた場合だけtrueを渡す。既定はfalse
  // (Setup側の重複ルール判定をそのまま尊重し、未確認の重複は常に拒否させる)。
  allowDuplicateSave?: boolean;
  // 2026-10-03追加: trueの場合、DUPLICATES_DETECTED発生時に重複候補の
  // オブジェクト種別+IDをエラーへ含めるようSalesforceへ要求する(値は含まれない)。
  // allowDuplicateSaveの可否には影響しない(確認用の読み取りフラグ)。
  includeDuplicateRecordDetails?: boolean;
}): Promise<SalesforceUpsertResult> {
  const label = `${input.sobject} upsert`;
  const response = await requestSalesforce(
    input.config,
    "PATCH",
    sobjectPath(input.sobject, input.externalIdField, input.externalId),
    label,
    input.fields,
    {
      allowDuplicateSave: input.allowDuplicateSave,
      includeDuplicateRecordDetails: input.includeDuplicateRecordDetails,
    }
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

/**
 * SOQLで複数レコードを読む(GET /query、読み取り専用)。nextRecordsUrlがある限り
 * 続きを辿って全件返す(maxRecordsで打ち切り可)。
 *
 * 2026-10-03追加: 本番移行前のLead/Clinic照合(scripts/salesforce-lead-clinic-match-readonly.ts)
 * 用。同期経路(salesforceSync.ts)からは呼ばない。SOQL文字列は呼び出し側が固定文字列で
 * 組み立て、ユーザー入力を埋め込まない前提(このヘルパーはエスケープを行わない)。
 */
export async function querySalesforceRecords(input: {
  config: SalesforceOAuthConfig;
  soql: string;
  maxRecords?: number;
}): Promise<SalesforceRecord[]> {
  const label = "SOQL query";
  const limit = input.maxRecords ?? Number.POSITIVE_INFINITY;
  const records: SalesforceRecord[] = [];
  let path: string | null = `/query?q=${encodeURIComponent(input.soql)}`;
  while (path && records.length < limit) {
    const response = await requestSalesforce(input.config, "GET", path, label);
    if (!response.ok) await throwForResponse(response, label);
    const body = (await response.json().catch(() => null)) as {
      records?: unknown;
      done?: unknown;
      nextRecordsUrl?: unknown;
    } | null;
    if (!body || !Array.isArray(body.records)) {
      throw new SalesforceDeliveryError(`Salesforce ${label} response was malformed.`);
    }
    for (const record of body.records) {
      if (!record || typeof (record as { Id?: unknown }).Id !== "string") {
        throw new SalesforceDeliveryError(`Salesforce ${label} response was malformed.`);
      }
      records.push(record as SalesforceRecord);
      if (records.length >= limit) break;
    }
    if (body.done === false && typeof body.nextRecordsUrl === "string") {
      // nextRecordsUrlは "/services/data/vXX.X/query/01g..." の形で返る。
      // requestSalesforceは "/services/data/vXX.X" を前置するため、その部分を取り除く。
      const marker = `/services/data/${API_VERSION}`;
      const index = body.nextRecordsUrl.indexOf(marker);
      path = index >= 0 ? body.nextRecordsUrl.slice(index + marker.length) : null;
      if (!path) throw new SalesforceDeliveryError(`Salesforce ${label} nextRecordsUrl was unexpected.`);
    } else {
      path = null;
    }
  }
  return records;
}

/** sobjects/{sobject}/describe から項目API名の集合を返す(読み取り専用)。 */
export async function getSalesforceSObjectFieldNames(input: {
  config: SalesforceOAuthConfig;
  sobject: string;
}): Promise<Set<string>> {
  const label = `${input.sobject} describe`;
  const response = await requestSalesforce(input.config, "GET", `/sobjects/${encodeURIComponent(input.sobject)}/describe`, label);
  if (!response.ok) await throwForResponse(response, label);
  const body = (await response.json().catch(() => null)) as { fields?: unknown } | null;
  if (!body || !Array.isArray(body.fields)) throw new SalesforceDeliveryError(`Salesforce ${label} response was malformed.`);
  return new Set(
    body.fields
      .map((f) => (f && typeof (f as { name?: unknown }).name === "string" ? ((f as { name: string }).name) : null))
      .filter((n): n is string => n !== null)
  );
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
