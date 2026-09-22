import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createStripeInviteCheckoutSession,
  scheduleStripeSubscriptionCancellation,
  StripeCheckoutProviderError,
} from "@/server/providers/billing/stripeCheckoutProvider";

afterEach(() => vi.unstubAllGlobals());

describe("createStripeInviteCheckoutSession(1円招待モニター専用)", () => {
  it("mode=subscriptionで作成し、招待metadataを含み、tax_rates/trial_period_days/cancel_atは含めない", async () => {
    // cancel_atはCheckout Session作成時のsubscription_dataには存在しないパラメータ
    // (実際にStripe APIへ送るとinvalid_request_errorになることを確認済み)。
    // durationMonths後の自動終了はscheduleStripeSubscriptionCancellation()で
    // 決済確定後に別途設定する。
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({ url: "https://checkout.stripe.com/c/pay/invite-session", id: "cs_test_invite" })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await createStripeInviteCheckoutSession({
      apiKey: "sk_test_secret",
      priceId: "price_invite_monitor",
      clinicId: "clinic-1",
      contactEmail: "owner@example.com",
      appBaseUrl: "https://dent-shift.example.com",
      successPath: "/invite/ABC123?checkout=success",
      cancelPath: "/invite/ABC123?checkout=cancelled",
      metadata: {
        clinicId: "clinic-1",
        plan: "standard",
        inviteCode: "ABC123",
        inviteId: "invite-1",
      },
    });

    expect(result.url).toBe("https://checkout.stripe.com/c/pay/invite-session");
    expect(result.id).toBe("cs_test_invite");
    const [, options] = fetchMock.mock.calls[0]!;
    const params = new URLSearchParams(options.body);
    expect(params.get("mode")).toBe("subscription");
    expect(params.get("line_items[0][price]")).toBe("price_invite_monitor");
    expect(params.get("metadata[plan]")).toBe("standard");
    expect(params.get("metadata[invite_code]")).toBe("ABC123");
    expect(params.get("metadata[invite_id]")).toBe("invite-1");
    expect(params.get("subscription_data[metadata][invite_code]")).toBe("ABC123");
    // 通常プランのtax_rates・trial_period_days、および招待特有のcancel_atも
    // Checkout Session作成時には一切付与しない。
    expect(params.has("line_items[0][tax_rates][0]")).toBe(false);
    expect(params.has("subscription_data[trial_period_days]")).toBe(false);
    expect(params.has("payment_method_collection")).toBe(false);
    expect(params.has("subscription_data[cancel_at]")).toBe(false);
  });
});

describe("scheduleStripeSubscriptionCancellation", () => {
  it("Subscriptionリソースへcancel_atをPOSTする", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await scheduleStripeSubscriptionCancellation({
      apiKey: "sk_test_secret",
      subscriptionId: "sub_invite_1",
      cancelAtEpochSeconds: 1798704000,
    });

    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.stripe.com/v1/subscriptions/sub_invite_1");
    expect(options.method).toBe("POST");
    const params = new URLSearchParams(options.body);
    expect(params.get("cancel_at")).toBe("1798704000");
  });

  it("Stripeが非2xxを返した場合はStripeCheckoutProviderError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 400 })));

    await expect(
      scheduleStripeSubscriptionCancellation({
        apiKey: "sk_test_secret",
        subscriptionId: "sub_invite_1",
        cancelAtEpochSeconds: 1798704000,
      })
    ).rejects.toBeInstanceOf(StripeCheckoutProviderError);
  });
});
