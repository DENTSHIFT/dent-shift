import { describe, expect, it } from "vitest";
import { SalesforceConfigError, resolveSalesforceConfig } from "@/server/config/salesforceConfig";

const COMPLETE_SALESFORCE_ENV = {
  SALESFORCE_PROVIDER: "salesforce",
  SALESFORCE_CLIENT_ID: "client_id_test",
  SALESFORCE_CLIENT_SECRET: "client_secret_test",
  SALESFORCE_LOGIN_URL: "https://login.salesforce.com",
};

describe("salesforceConfig", () => {
  it("未設定時は同期を開始できないdisabledになる(既存のCRM自社開発方針の後方互換)", () => {
    expect(resolveSalesforceConfig({ env: {} })).toEqual({ provider: "disabled" });
  });

  it("salesforceを明示し、必須値がある場合だけ設定を返す", () => {
    expect(resolveSalesforceConfig({ env: COMPLETE_SALESFORCE_ENV })).toEqual({
      provider: "salesforce",
      clientId: "client_id_test",
      clientSecret: "client_secret_test",
      loginUrl: "https://login.salesforce.com",
    });
  });

  it("不正なprovider名は明示エラーにする", () => {
    expect(() => resolveSalesforceConfig({ env: { SALESFORCE_PROVIDER: "hubspot" } })).toThrow(
      SalesforceConfigError
    );
  });

  it.each([
    ["SALESFORCE_CLIENT_ID"],
    ["SALESFORCE_CLIENT_SECRET"],
    ["SALESFORCE_LOGIN_URL"],
  ])("%sなしではsalesforceを有効化しない", (missingKey) => {
    const env = { ...COMPLETE_SALESFORCE_ENV, [missingKey]: "" };
    expect(() => resolveSalesforceConfig({ env })).toThrow(SalesforceConfigError);
  });

  it("httpsでないログインURLを拒否する", () => {
    expect(() =>
      resolveSalesforceConfig({
        env: { ...COMPLETE_SALESFORCE_ENV, SALESFORCE_LOGIN_URL: "http://login.salesforce.com" },
      })
    ).toThrow(SalesforceConfigError);
  });

  it("クライアントシークレット値を設定エラーへ含めない", () => {
    const clientSecret = "secret_should_never_leak";
    let caught: unknown;
    try {
      resolveSalesforceConfig({
        env: { ...COMPLETE_SALESFORCE_ENV, SALESFORCE_CLIENT_SECRET: clientSecret, SALESFORCE_LOGIN_URL: "" },
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SalesforceConfigError);
    expect((caught as Error).message).not.toContain(clientSecret);
  });
});
