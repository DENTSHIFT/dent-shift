import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SalesforceDeliveryError,
  upsertSalesforceLeadByEmail,
} from "@/server/providers/salesforce/salesforceClient";

const CONFIG = {
  provider: "salesforce" as const,
  clientId: "client_id_test",
  clientSecret: "client_secret_should_never_leak",
  loginUrl: "https://login.salesforce.com",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function tokenResponse() {
  return new Response(
    JSON.stringify({ access_token: "token_abc", instance_url: "https://instance.salesforce.com" }),
    { status: 200 }
  );
}

describe("upsertSalesforceLeadByEmail", () => {
  it("既存Leadがあれば更新し、そのIdを返す", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ records: [{ Id: "00Qexisting" }] }), { status: 200 })
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await upsertSalesforceLeadByEmail({
      config: CONFIG,
      fields: {
        email: "clinic@example.com",
        clinic_name: "テスト歯科",
        website_url: "https://clinic.example.com",
        phone: null,
        lead_source: "DENT SHIFT 無料AI診断",
      },
    });

    expect(result).toEqual({ salesforceId: "00Qexisting" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [updateUrl, updateOptions] = fetchMock.mock.calls[2]!;
    expect(updateUrl).toBe("https://instance.salesforce.com/services/data/v60.0/sobjects/Lead/00Qexisting");
    expect(updateOptions.method).toBe("PATCH");
  });

  it("既存Leadがなければ新規作成し、そのIdを返す", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({ records: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "00Qnew" }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await upsertSalesforceLeadByEmail({
      config: CONFIG,
      fields: {
        email: "new@example.com",
        clinic_name: null,
        website_url: null,
        phone: null,
        lead_source: "DENT SHIFT 無料AI診断",
      },
    });

    expect(result).toEqual({ salesforceId: "00Qnew" });
  });

  it("OAuthトークン取得失敗時はclientSecretを例外へ含めない", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("body", { status: 401 })));

    let caught: unknown;
    try {
      await upsertSalesforceLeadByEmail({
        config: CONFIG,
        fields: {
          email: "a@example.com",
          clinic_name: null,
          website_url: null,
          phone: null,
          lead_source: "DENT SHIFT 無料AI診断",
        },
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(SalesforceDeliveryError);
    expect((caught as Error).message).not.toContain(CONFIG.clientSecret);
  });

  it("SOQLインジェクション対策: バックスラッシュ+クォートを含むemailで文字列リテラルを閉じられない", async () => {
    // 素朴に「'」だけを「\'」へ置換する実装だと、値が既に「\」で終わる場合に
    // エスケープ処理をすり抜けて文字列リテラルを閉じられてしまう
    // (このプロジェクトのメール形式チェックはローカル部の「\」「'」を禁止していない)。
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({ records: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "00Qnew" }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    const maliciousEmail = "a\\'or Id!=null limit 200--@example.com";
    await upsertSalesforceLeadByEmail({
      config: CONFIG,
      fields: {
        email: maliciousEmail,
        clinic_name: null,
        website_url: null,
        phone: null,
        lead_source: "DENT SHIFT 無料AI診断",
      },
    });

    const [queryUrl] = fetchMock.mock.calls[1]!;
    const query = decodeURIComponent(new URL(queryUrl as string).searchParams.get("q") ?? "");
    // 埋め込んだ値の中の「'」がすべてSOQL上でエスケープされたままであり、
    // 文字列リテラルが途中で閉じられていないことを確認する
    // (閉じられていれば "Email = '...'" の外側に生の "or Id!=null" 等が出現するはず)。
    expect(query).toBe("SELECT Id FROM Lead WHERE Email = 'a\\\\\\'or Id!=null limit 200--@example.com' LIMIT 1");
  });
});
