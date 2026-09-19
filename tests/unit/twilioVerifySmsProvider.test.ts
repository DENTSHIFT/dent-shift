import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SmsDeliveryError,
  createTwilioVerifySmsProvider,
} from "@/server/providers/sms/twilioVerifySmsProvider";

const CONFIG = {
  provider: "twilio-verify" as const,
  accountSid: "AC_test_sid",
  authToken: "auth_should_never_leak",
  verifyServiceSid: "VA_test_service",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("twilioVerifySmsProvider", () => {
  it("Basic認証headerを付与してVerifications APIを呼ぶ", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    const provider = createTwilioVerifySmsProvider(CONFIG);
    const result = await provider.sendVerification("+819012345678");

    expect(result).toEqual({ status: "sent" });
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      "https://verify.twilio.com/v2/Services/VA_test_service/Verifications"
    );
    expect(options.headers.Authorization).toMatch(/^Basic /);
  });

  it("送信失敗時はauthTokenを例外へ含めない", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("body", { status: 500 })));

    const provider = createTwilioVerifySmsProvider(CONFIG);
    let caught: unknown;
    try {
      await provider.sendVerification("+819012345678");
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(SmsDeliveryError);
    expect((caught as Error).message).not.toContain(CONFIG.authToken);
  });

  it("コード正解時はapprovedを返す", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "approved" }), { status: 200 }))
    );

    const provider = createTwilioVerifySmsProvider(CONFIG);
    expect(await provider.checkVerification("+819012345678", "123456")).toBe("approved");
  });

  it("コード誤り時はdeniedを返す", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "pending" }), { status: 200 }))
    );

    const provider = createTwilioVerifySmsProvider(CONFIG);
    expect(await provider.checkVerification("+819012345678", "000000")).toBe("denied");
  });

  it("検証セッション期限切れ(404)時はexpiredを返す", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));

    const provider = createTwilioVerifySmsProvider(CONFIG);
    expect(await provider.checkVerification("+819012345678", "123456")).toBe("expired");
  });
});
