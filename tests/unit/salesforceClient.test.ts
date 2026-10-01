import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ORG_MISMATCH_ERROR_CODE,
  SalesforceDeliveryError,
  clearSalesforceTokenCacheForTests,
  getSalesforceRecordByExternalId,
  updateSalesforceRecordById,
  upsertSalesforceRecordByExternalId,
} from "@/server/providers/salesforce/salesforceClient";

const CONFIG = {
  provider: "salesforce" as const,
  clientId: "client_id_test",
  clientSecret: "client_secret_should_never_leak",
  loginUrl: "https://login.salesforce.com",
  expectedOrgId: "00D000000000001",
};

beforeEach(() => {
  clearSalesforceTokenCacheForTests();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function tokenResponse(token = "token_abc", orgId = "00D000000000001AAA") {
  return new Response(
    JSON.stringify({
      access_token: token,
      instance_url: "https://instance.salesforce.com",
      id: `https://login.salesforce.com/id/${orgId}/005000000000001AAA`,
    }),
    { status: 200 }
  );
}

function upsert(fields: Record<string, unknown> = { Company: "テスト歯科" }) {
  return upsertSalesforceRecordByExternalId({
    config: CONFIG,
    sobject: "Lead",
    externalIdField: "DentShift_Clinic_Id__c",
    externalId: "clinic_1",
    fields,
  });
}

describe("upsertSalesforceRecordByExternalId", () => {
  it("外部ID(医院ID)のURLへPATCHし、メールアドレスでの検索(SOQL)は行わない", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "00Qnew", created: true }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await upsert();

    expect(result).toEqual({ id: "00Qnew", created: true });
    const [url, init] = fetchMock.mock.calls[1]!;
    expect(url).toBe(
      "https://instance.salesforce.com/services/data/v60.0/sobjects/Lead/DentShift_Clinic_Id__c/clinic_1"
    );
    expect(init.method).toBe("PATCH");
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/query"))).toBe(false);
  });

  it("既存レコードの更新(200)はcreated=falseを返す", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(new Response(JSON.stringify({ id: "00Qold", created: false }), { status: 200 }))
    );
    await expect(upsert()).resolves.toEqual({ id: "00Qold", created: false });
  });

  it("アクセストークンをキャッシュし、2回目の呼び出しでは再取得しない", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "a", created: true }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "a", created: false }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await upsert();
    await upsert();

    const tokenCalls = fetchMock.mock.calls.filter(([u]) => String(u).includes("/oauth2/token"));
    expect(tokenCalls).toHaveLength(1);
  });

  it("401ならトークンを1回だけ再取得して再送する", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse("old"))
      .mockResolvedValueOnce(new Response("[]", { status: 401 }))
      .mockResolvedValueOnce(tokenResponse("new"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "b", created: false }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(upsert()).resolves.toEqual({ id: "b", created: false });
    expect(fetchMock.mock.calls[3]![1].headers.Authorization).toBe("Bearer new");
  });

  it("エラー時はerrorCodeと項目名だけを例外に含め、送信値やclient secretを含めない", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify([
              { errorCode: "INVALID_FIELD", message: "bad value 院長名テスト", fields: ["LastName"] },
            ]),
            { status: 400 }
          )
        )
    );

    const error = await upsert({ LastName: "院長名テスト" }).catch((e) => e);
    expect(error).toBeInstanceOf(SalesforceDeliveryError);
    expect(error.errorCode).toBe("INVALID_FIELD");
    expect(error.message).toContain("fields=LastName");
    expect(error.message).not.toContain("院長名テスト");
    expect(error.message).not.toContain(CONFIG.clientSecret);
  });

  it("トークン取得失敗はSalesforceDeliveryErrorになり、client secretを含めない", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("", { status: 400 })));
    const error = await upsert().catch((e) => e);
    expect(error).toBeInstanceOf(SalesforceDeliveryError);
    expect(error.message).not.toContain(CONFIG.clientSecret);
  });
});

describe("接続先組織の確認", () => {
  it("トークンの組織IDがSALESFORCE_EXPECTED_ORG_IDと異なる場合は、何も書き込まずに中断する", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(tokenResponse("t", "00D999999999999AAA"));
    vi.stubGlobal("fetch", fetchMock);

    const error = await upsert().catch((e) => e);

    expect(error).toBeInstanceOf(SalesforceDeliveryError);
    expect(error.errorCode).toBe(ORG_MISMATCH_ERROR_CODE);
    expect(fetchMock).toHaveBeenCalledTimes(1); // トークン取得のみ。PATCHは送らない
  });
});

describe("getSalesforceRecordByExternalId / updateSalesforceRecordById", () => {
  it("外部IDで読み、存在しなければnullを返す(読む項目は指定分とIdだけ)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({ Id: "00Q1", IsConverted: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response("[]", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    const args = { config: CONFIG, sobject: "Lead", externalIdField: "DentShift_Clinic_Id__c", externalId: "clinic_1", fields: ["IsConverted"] };

    await expect(getSalesforceRecordByExternalId(args)).resolves.toEqual({ Id: "00Q1", IsConverted: true });
    await expect(getSalesforceRecordByExternalId(args)).resolves.toBeNull();
    const [url, init] = fetchMock.mock.calls[1]!;
    expect(String(url)).toBe(
      "https://instance.salesforce.com/services/data/v60.0/sobjects/Lead/DentShift_Clinic_Id__c/clinic_1?fields=Id%2CIsConverted"
    );
    expect(init.method).toBe("GET");
  });

  it("Salesforce IDを指定して既存レコードだけを更新する", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await updateSalesforceRecordById({ config: CONFIG, sobject: "Account", id: "001A", fields: { DentShift_Clinic_Id__c: "clinic_1" } });

    const [url, init] = fetchMock.mock.calls[1]!;
    expect(url).toBe("https://instance.salesforce.com/services/data/v60.0/sobjects/Account/001A");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ DentShift_Clinic_Id__c: "clinic_1" });
  });
});
