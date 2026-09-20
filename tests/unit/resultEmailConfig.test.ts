import { describe, expect, it } from "vitest";
import {
  ResultEmailConfigError,
  resolveResultEmailConfig,
} from "@/server/config/resultEmailConfig";

describe("resultEmailConfig", () => {
  it("未設定時は特定providerへ自動接続せずdisabledになる", () => {
    expect(resolveResultEmailConfig({ env: {} })).toEqual({ provider: "disabled" });
  });

  it("resendを明示し、必須値がある場合だけ設定を返す", () => {
    expect(
      resolveResultEmailConfig({
        env: {
          RESULT_EMAIL_PROVIDER: "resend",
          RESEND_API_KEY: "re_test_secret",
          RESULT_EMAIL_FROM: "DENT SHIFT <diagnosis@example.com>",
          APP_BASE_URL: "https://dent-shift.example.com/path?ignored=1",
        },
      })
    ).toEqual({
      provider: "resend",
      apiKey: "re_test_secret",
      from: "DENT SHIFT <diagnosis@example.com>",
      appBaseUrl: "https://dent-shift.example.com",
    });
  });

  it.each([
    [{ RESULT_EMAIL_PROVIDER: "other" }, "other provider"],
    [{ RESULT_EMAIL_PROVIDER: "resend" }, "api key"],
    [
      { RESULT_EMAIL_PROVIDER: "resend", RESEND_API_KEY: "secret" },
      "sender",
    ],
    [
      {
        RESULT_EMAIL_PROVIDER: "resend",
        RESEND_API_KEY: "secret",
        RESULT_EMAIL_FROM: "sender@example.com",
      },
      "base URL",
    ],
  ])("不完全・不正な設定は明示エラーにする: %s (%s)", (env, _reason) => {
    expect(() => resolveResultEmailConfig({ env })).toThrow(ResultEmailConfigError);
  });

  it("設定エラーへAPI key値を含めない", () => {
    const apiKey = "re_should_never_leak";
    let caught: unknown;
    try {
      resolveResultEmailConfig({
        env: {
          RESULT_EMAIL_PROVIDER: "resend",
          RESEND_API_KEY: apiKey,
        },
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ResultEmailConfigError);
    expect((caught as Error).message).not.toContain(apiKey);
  });
});
