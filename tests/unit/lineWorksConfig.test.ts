import { describe, expect, it } from "vitest";
import { LineWorksConfigError, resolveLineWorksConfig } from "@/server/config/lineWorksConfig";

const COMPLETE_ENV = {
  LINE_WORKS_PROVIDER: "lineworks",
  LINE_WORKS_CLIENT_ID: "client_id_test",
  LINE_WORKS_CLIENT_SECRET: "client_secret_test",
  LINE_WORKS_SERVICE_ACCOUNT: "sa_test@example",
  LINE_WORKS_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----",
  LINE_WORKS_BOT_ID: "bot_id_test",
  LINE_WORKS_BOT_SECRET: "bot_secret_test",
};

describe("lineWorksConfig", () => {
  it("未設定時はLINE WORKS連携を開始できないdisabledになる(開通・契約待ちの既定値)", () => {
    expect(resolveLineWorksConfig({ env: {} })).toEqual({ provider: "disabled" });
  });

  it("lineworksを明示し、必須値がある場合だけ設定を返す", () => {
    expect(resolveLineWorksConfig({ env: COMPLETE_ENV })).toEqual({
      provider: "lineworks",
      clientId: "client_id_test",
      clientSecret: "client_secret_test",
      serviceAccount: "sa_test@example",
      privateKey: COMPLETE_ENV.LINE_WORKS_PRIVATE_KEY,
      botId: "bot_id_test",
      botSecret: "bot_secret_test",
    });
  });

  it("不正なprovider名は明示エラーにする", () => {
    expect(() => resolveLineWorksConfig({ env: { LINE_WORKS_PROVIDER: "other" } })).toThrow(
      LineWorksConfigError
    );
  });

  it.each([
    ["LINE_WORKS_CLIENT_ID"],
    ["LINE_WORKS_CLIENT_SECRET"],
    ["LINE_WORKS_SERVICE_ACCOUNT"],
    ["LINE_WORKS_PRIVATE_KEY"],
    ["LINE_WORKS_BOT_ID"],
    ["LINE_WORKS_BOT_SECRET"],
  ])("%sなしではlineworksを有効化しない", (missingKey) => {
    const env = { ...COMPLETE_ENV, [missingKey]: "" };
    expect(() => resolveLineWorksConfig({ env })).toThrow(LineWorksConfigError);
  });
});
