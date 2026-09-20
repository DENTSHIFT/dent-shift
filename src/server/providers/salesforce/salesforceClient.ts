import "server-only";
import type { SalesforceOAuthConfig } from "@/server/config/salesforceConfig";

export class SalesforceDeliveryError extends Error {}

interface SalesforceAccessToken {
  accessToken: string;
  instanceUrl: string;
}

/**
 * OAuth 2.0 Client Credentials Flowでアクセストークンを取得する。
 * 実際に採用するConnected App方式(JWT Bearer等)は契約確定後に差し替える前提
 * (指示書17章・23章、STEP6で人間側確認事項として報告する)。
 */
async function fetchAccessToken(config: SalesforceOAuthConfig): Promise<SalesforceAccessToken> {
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
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new SalesforceDeliveryError("Salesforce OAuth token request failed.");
  }

  if (!response.ok) {
    throw new SalesforceDeliveryError(`Salesforce OAuth token request returned HTTP ${response.status}.`);
  }

  const body = (await response.json()) as { access_token?: string; instance_url?: string };
  if (!body.access_token || !body.instance_url) {
    throw new SalesforceDeliveryError("Salesforce OAuth token response was malformed.");
  }
  return { accessToken: body.access_token, instanceUrl: body.instance_url };
}

export interface SalesforceLeadFields {
  email: string;
  clinic_name: string | null;
  website_url: string | null;
  phone: string | null;
  lead_source: string;
  [key: string]: string | number | boolean | null;
}

/**
 * SOQL文字列リテラルへ値を埋め込む前に安全化する。バックスラッシュを先にエスケープ
 * してからシングルクォートをエスケープしないと、値の末尾がバックスラッシュの場合に
 * (例: メールアドレスのローカル部に`\`と`'`を含む文字列)エスケープ処理をすり抜けて
 * 文字列リテラルを閉じられ、SOQLインジェクションが成立してしまう
 * (このプロジェクトのメール形式チェックはローカル部に`\`や`'`を禁止していない)。
 */
function escapeSoqlStringLiteral(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/**
 * メールアドレスをキーにLeadを検索し、あれば更新・なければ新規作成する(指示書8章・9章)。
 * カスタム項目API名は推測せず、呼び出し側がfieldsとして渡した値のみを送信する。
 */
export async function upsertSalesforceLeadByEmail(input: {
  config: SalesforceOAuthConfig;
  fields: SalesforceLeadFields;
}): Promise<{ salesforceId: string }> {
  const token = await fetchAccessToken(input.config);

  const query = `SELECT Id FROM Lead WHERE Email = '${escapeSoqlStringLiteral(input.fields.email)}' LIMIT 1`;
  let searchResponse: Response;
  try {
    searchResponse = await fetch(
      `${token.instanceUrl}/services/data/v60.0/query?q=${encodeURIComponent(query)}`,
      {
        headers: { Authorization: `Bearer ${token.accessToken}` },
        signal: AbortSignal.timeout(10_000),
      }
    );
  } catch {
    throw new SalesforceDeliveryError("Salesforce Lead lookup request failed.");
  }
  if (!searchResponse.ok) {
    throw new SalesforceDeliveryError(`Salesforce Lead lookup returned HTTP ${searchResponse.status}.`);
  }
  const searchBody = (await searchResponse.json()) as { records?: Array<{ Id: string }> };
  const existingId = searchBody.records?.[0]?.Id;

  const leadPayload = {
    Email: input.fields.email,
    Company: input.fields.clinic_name ?? input.fields.email,
    LastName: input.fields.clinic_name ?? input.fields.email,
    Website: input.fields.website_url ?? undefined,
    Phone: input.fields.phone ?? undefined,
    LeadSource: input.fields.lead_source,
  };

  if (existingId) {
    let updateResponse: Response;
    try {
      updateResponse = await fetch(
        `${token.instanceUrl}/services/data/v60.0/sobjects/Lead/${existingId}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(leadPayload),
          signal: AbortSignal.timeout(10_000),
        }
      );
    } catch {
      throw new SalesforceDeliveryError("Salesforce Lead update request failed.");
    }
    if (!updateResponse.ok && updateResponse.status !== 204) {
      throw new SalesforceDeliveryError(`Salesforce Lead update returned HTTP ${updateResponse.status}.`);
    }
    return { salesforceId: existingId };
  }

  let createResponse: Response;
  try {
    createResponse = await fetch(`${token.instanceUrl}/services/data/v60.0/sobjects/Lead`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(leadPayload),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new SalesforceDeliveryError("Salesforce Lead create request failed.");
  }
  if (!createResponse.ok) {
    throw new SalesforceDeliveryError(`Salesforce Lead create returned HTTP ${createResponse.status}.`);
  }
  const createBody = (await createResponse.json()) as { id?: string };
  if (!createBody.id) {
    throw new SalesforceDeliveryError("Salesforce Lead create response was malformed.");
  }
  return { salesforceId: createBody.id };
}
