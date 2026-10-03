import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ORG_MISMATCH_ERROR_CODE,
  SalesforceDeliveryError,
  clearSalesforceTokenCacheForTests,
  getSalesforceRecordByExternalId,
  querySalesforceRecords,
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

  it("allowDuplicateSave=trueの時だけSforce-Duplicate-Rule-Headerを送る(既定では送らない)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "00Q1", created: false }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "00Q1", created: false }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await upsert(); // allowDuplicateSave未指定(既定)
    const [, defaultInit] = fetchMock.mock.calls[1]!;
    expect(defaultInit.headers).not.toHaveProperty("Sforce-Duplicate-Rule-Header");

    await upsertSalesforceRecordByExternalId({
      config: CONFIG,
      sobject: "Lead",
      externalIdField: "DentShift_Clinic_Id__c",
      externalId: "clinic_1",
      fields: { Company: "テスト歯科" },
      allowDuplicateSave: true,
    });
    // 2回目呼び出しはトークンをキャッシュから再利用するため、fetchはPATCH 1回だけ(index 2)。
    const [, allowInit] = fetchMock.mock.calls[2]!;
    expect(allowInit.headers["Sforce-Duplicate-Rule-Header"]).toBe("allowSave=true");
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

  it("DUPLICATES_DETECTEDの応答から重複候補(オブジェクト種別+IDのみ)を取り出す", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify([
              {
                errorCode: "DUPLICATES_DETECTED",
                message: "Use one of these records?",
                duplicateResult: {
                  matchResults: [
                    {
                      matchEngine: "ExactMatchEngine",
                      rule: "Standard Lead Matching Rule",
                      matchRecords: [
                        {
                          record: {
                            Id: "00Qown000000000AAA",
                            Email: "owner@example-dental.jp",
                            attributes: { type: "Lead" },
                          },
                        },
                      ],
                    },
                  ],
                },
              },
            ]),
            { status: 400 }
          )
        )
    );

    const error = await upsert().catch((e) => e);
    expect(error.errorCode).toBe("DUPLICATES_DETECTED");
    expect(error.duplicateCandidates).toEqual([{ sobjectType: "Lead", id: "00Qown000000000AAA" }]);
    // 候補レコードのEmail等の値は例外messageへ含めない
    expect(error.message).not.toContain("owner@example-dental.jp");
  });

  it("綴り違いのduplicateResut(実機で確認済みの別綴り)でも重複候補を読み取る", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify([
              {
                errorCode: "DUPLICATES_DETECTED",
                duplicateResut: {
                  matchResults: [
                    { matchRecords: [{ record: { Id: "00Qx", attributes: { type: "Lead" } } }] },
                  ],
                },
              },
            ]),
            { status: 400 }
          )
        )
    );

    const error = await upsert().catch((e) => e);
    expect(error.duplicateCandidates).toEqual([{ sobjectType: "Lead", id: "00Qx" }]);
  });

  it("複数のmatchResultsの一方に不正な候補(ID欠損)が混ざる場合、他が正常でも全体をnullにする", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify([
              {
                errorCode: "DUPLICATES_DETECTED",
                duplicateResult: {
                  matchResults: [
                    {
                      rule: "Standard Lead Matching Rule",
                      matchRecords: [{ record: { Id: "00Qown000000000AAA", attributes: { type: "Lead" } } }],
                    },
                    {
                      rule: "Standard Contact Duplicate Rule",
                      // ID欠損の不正な候補(例: Salesforce側の応答が一部欠けている場合)
                      matchRecords: [{ record: { attributes: { type: "Contact" } } }],
                    },
                  ],
                },
              },
            ]),
            { status: 400 }
          )
        )
    );

    const error = await upsert().catch((e) => e);
    // 残りの「正常に見える」候補だけで保存許可してしまわないよう、全体を情報不足(null)扱いにする
    expect(error.duplicateCandidates).toBeNull();
  });

  it("1つのmatchRecords内で、正常な候補の後にtype欠損の候補が混ざる場合も全体をnullにする", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify([
              {
                errorCode: "DUPLICATES_DETECTED",
                duplicateResult: {
                  matchResults: [
                    {
                      rule: "Standard Lead Matching Rule",
                      matchRecords: [
                        { record: { Id: "00Qown000000000AAA", attributes: { type: "Lead" } } },
                        { record: { Id: "00Qextra000000AAA", attributes: {} } }, // typeが空
                      ],
                    },
                  ],
                },
              },
            ]),
            { status: 400 }
          )
        )
    );

    const error = await upsert().catch((e) => e);
    expect(error.duplicateCandidates).toBeNull();
  });

  it("重複候補の構造自体が応答にない場合はduplicateCandidates=nullを返す", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(
          new Response(JSON.stringify([{ errorCode: "DUPLICATES_DETECTED", message: "x" }]), { status: 400 })
        )
    );

    const error = await upsert().catch((e) => e);
    expect(error.duplicateCandidates).toBeNull();
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

describe("querySalesforceRecords(2026-10-03追加、読み取り専用SOQL)", () => {
  it("GET /query で読み、nextRecordsUrlがあれば続きを辿って全件返す(PATCHは一切送らない)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            totalSize: 3,
            done: false,
            nextRecordsUrl: "/services/data/v60.0/query/01gXX-2000",
            records: [{ Id: "00Q1" }, { Id: "00Q2" }],
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ totalSize: 3, done: true, records: [{ Id: "00Q3" }] }), { status: 200 })
      );
    vi.stubGlobal("fetch", fetchMock);

    const records = await querySalesforceRecords({ config: CONFIG, soql: "SELECT Id FROM Lead WHERE IsConverted = false" });

    expect(records.map((r) => r.Id)).toEqual(["00Q1", "00Q2", "00Q3"]);
    expect(String(fetchMock.mock.calls[1]![0])).toBe(
      "https://instance.salesforce.com/services/data/v60.0/query?q=SELECT%20Id%20FROM%20Lead%20WHERE%20IsConverted%20%3D%20false"
    );
    expect(String(fetchMock.mock.calls[2]![0])).toBe("https://instance.salesforce.com/services/data/v60.0/query/01gXX-2000");
    expect(fetchMock.mock.calls.slice(1).every(([, init]) => init.method === "GET")).toBe(true);
  });

  it("maxRecordsに達したら続きを辿らない", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ done: false, nextRecordsUrl: "/services/data/v60.0/query/01gXX-2000", records: [{ Id: "00Q1" }, { Id: "00Q2" }] }),
          { status: 200 }
        )
      );
    vi.stubGlobal("fetch", fetchMock);

    const records = await querySalesforceRecords({ config: CONFIG, soql: "SELECT Id FROM Lead", maxRecords: 1 });

    expect(records.map((r) => r.Id)).toEqual(["00Q1"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("応答が不正(recordsが配列でない/Idが無い)ならSalesforceDeliveryError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(new Response(JSON.stringify({ records: [{ Name: "x" }] }), { status: 200 }))
    );
    await expect(querySalesforceRecords({ config: CONFIG, soql: "SELECT Id FROM Lead" })).rejects.toBeInstanceOf(SalesforceDeliveryError);
  });

  it("HTTPエラーはerrorCode付きのSalesforceDeliveryErrorになる", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(new Response(JSON.stringify([{ errorCode: "MALFORMED_QUERY", message: "x" }]), { status: 400 }))
    );
    await expect(querySalesforceRecords({ config: CONFIG, soql: "SELECT" })).rejects.toMatchObject({ errorCode: "MALFORMED_QUERY" });
  });
});
