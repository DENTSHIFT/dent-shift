import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createStripeCheckoutSession,
  StripeCheckoutProviderError,
} from "@/server/providers/billing/stripeCheckoutProvider";

afterEach(() => vi.unstubAllGlobals());

describe("Stripe Checkout provider", () => {
  it("APIキーをAuthorizationだけに設定し、医院とプランを照合可能にする", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({ url: "https://checkout.stripe.com/c/pay/test-session" })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await createStripeCheckoutSession({
      apiKey: "sk_test_secret",
      priceId: "price_standard",
      taxRateId: "txr_japan_10_percent",
      plan: "standard",
      clinicId: "clinic-1",
      contactEmail: "owner@example.com",
      appBaseUrl: "https://dent-shift.example.com",
    });

    expect(result.url).toBe("https://checkout.stripe.com/c/pay/test-session");
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(options.headers.Authorization).toBe("Bearer sk_test_secret");
    const params = new URLSearchParams(options.body);
    expect(params.get("mode")).toBe("subscription");
    expect(params.get("line_items[0][price]")).toBe("price_standard");
    expect(params.get("line_items[0][tax_rates][0]")).toBe("txr_japan_10_percent");
    expect(params.get("client_reference_id")).toBe("clinic-1");
    expect(params.get("metadata[plan]")).toBe("standard");
    expect(params.get("success_url")).toBe(
      "https://dent-shift.example.com/onboarding?checkout=success"
    );
  });

  it("Stripe以外のリダイレクトURLを拒否する", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ url: "https://evil.example.com" })));

    await expect(
      createStripeCheckoutSession({
        apiKey: "secret",
        priceId: "price_light",
        taxRateId: "txr_japan_10_percent",
        plan: "light",
        clinicId: "clinic-1",
        contactEmail: "owner@example.com",
        appBaseUrl: "https://dent-shift.example.com",
      })
    ).rejects.toBeInstanceOf(StripeCheckoutProviderError);
  });
});
