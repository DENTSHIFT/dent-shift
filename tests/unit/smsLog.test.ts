import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { logSmsEvent } from "@/server/providers/sms/smsLog";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("logSmsEvent", () => {
  it("環境・ホスト・SID・結果だけを構造化して出し、電話番号は含めない", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("APP_BASE_URL", "https://test.dentshift.jp");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "abcdef1234567");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    logSmsEvent({ purpose: "phone_verify_send", result: "accepted", requestSid: "VE1", providerStatus: "pending" });
    const line = JSON.parse(info.mock.calls[0]![0] as string);
    expect(line).toMatchObject({
      event: "sms_verification",
      env: "production",
      host: "test.dentshift.jp",
      commit: "abcdef1",
      result: "accepted",
      requestSid: "VE1",
    });
    expect(JSON.stringify(line)).not.toMatch(/\+81|090/);
  });

  it("失敗はerrorレベルでHTTPステータスとエラーコードを出す", () => {
    vi.stubEnv("APP_BASE_URL", "");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    logSmsEvent({ purpose: "password_reset_sms_send", result: "failed", httpStatus: 400, errorCode: 60200 });
    expect(JSON.parse(error.mock.calls[0]![0] as string)).toMatchObject({ result: "failed", httpStatus: 400, errorCode: 60200, host: "unknown" });
  });
});
