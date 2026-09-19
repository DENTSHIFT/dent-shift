import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createStripeCustomerPortalSession,
  StripeCustomerPortalProviderError,
} from "@/server/providers/billing/stripeCustomerPortalProvider";

afterEach(() => vi.unstubAllGlobals());

describe("Stripe customer portal provider", () => {
  it("契約のStripe顧客から一時的な管理画面URLを作成する", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ customer: "cus_customer1" }))
      .mockResolvedValueOnce(
        Response.json({ url: "https://billing.stripe.com/p/session/test-session" })
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await createStripeCustomerPortalSession({
      apiKey: "sk_test_secret",
      externalSubscriptionId: "sub_subscription1",
      appBaseUrl: "https://dent-shift.example.com",
    });

    expect(result.url).toBe("https://billing.stripe.com/p/session/test-session");
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.stripe.com/v1/subscriptions/sub_subscription1"
    );
    const [, portalOptions] = fetchMock.mock.calls[1]!;
    expect(portalOptions.headers.Authorization).toBe("Bearer sk_test_secret");
    const params = new URLSearchParams(portalOptions.body);
    expect(params.get("customer")).toBe("cus_customer1");
    expect(params.get("return_url")).toBe(
      "https://dent-shift.example.com/dashboard#subscription"
    );
  });

  it("Stripe以外の管理画面URLを拒否する", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ customer: "cus_customer1" }))
        .mockResolvedValueOnce(Response.json({ url: "https://evil.example.com/session" }))
    );

    await expect(
      createStripeCustomerPortalSession({
        apiKey: "secret",
        externalSubscriptionId: "sub_subscription1",
        appBaseUrl: "https://dent-shift.example.com",
      })
    ).rejects.toBeInstanceOf(StripeCustomerPortalProviderError);
  });

  it("契約にStripe顧客が紐づいていない場合は中断する", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ customer: null })));

    await expect(
      createStripeCustomerPortalSession({
        apiKey: "secret",
        externalSubscriptionId: "sub_subscription1",
        appBaseUrl: "https://dent-shift.example.com",
      })
    ).rejects.toBeInstanceOf(StripeCustomerPortalProviderError);
  });
});
