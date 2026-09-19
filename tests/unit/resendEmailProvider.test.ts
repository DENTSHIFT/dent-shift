import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ResultEmailDeliveryError,
  sendWithResend,
} from "@/server/providers/email/resendEmailProvider";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resendEmailProvider", () => {
  it("API keyをAuthorization headerだけに設定してメールを送る", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await sendWithResend({
      apiKey: "re_test_secret",
      from: "sender@example.com",
      to: "clinic@example.com",
      message: { subject: "件名", text: "本文", html: "<p>本文</p>" },
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.resend.com/emails");
    expect(options.headers.Authorization).toBe("Bearer re_test_secret");
    expect(JSON.parse(options.body)).toEqual(
      expect.objectContaining({
        from: "sender@example.com",
        to: ["clinic@example.com"],
        subject: "件名",
      })
    );
  });

  it("provider失敗時もresponse本文やAPI keyを例外へ含めない", async () => {
    const apiKey = "re_should_never_leak";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(`provider body containing ${apiKey}`, { status: 403 })
      )
    );

    let caught: unknown;
    try {
      await sendWithResend({
        apiKey,
        from: "sender@example.com",
        to: "clinic@example.com",
        message: { subject: "件名", text: "本文", html: "<p>本文</p>" },
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ResultEmailDeliveryError);
    expect((caught as Error).message).toBe("Result email provider returned HTTP 403.");
    expect((caught as Error).message).not.toContain(apiKey);
    expect((caught as Error).message).not.toContain("provider body");
  });
});
