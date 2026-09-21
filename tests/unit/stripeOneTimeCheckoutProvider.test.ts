import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createStripeOneTimeCheckoutSession,
  StripeCheckoutProviderError,
} from "@/server/providers/billing/stripeCheckoutProvider";

afterEach(() => vi.unstubAllGlobals());

describe("createStripeOneTimeCheckoutSession", () => {
  it("mode=paymentで作成し、metadataに指定4項目を必ず含める", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({ url: "https://checkout.stripe.com/c/pay/one-time-session", id: "cs_test_onetime" })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await createStripeOneTimeCheckoutSession({
      apiKey: "sk_test_secret",
      priceId: "price_instruction_pdf",
      clinicId: "clinic-1",
      contactEmail: "owner@example.com",
      appBaseUrl: "https://dent-shift.example.com",
      successPath: "/dashboard/options/instruction-pdf?checkout=success",
      cancelPath: "/dashboard/options/instruction-pdf?checkout=cancelled",
      metadata: {
        clinicId: "clinic-1",
        reportId: "report-1",
        version: "1",
        optionProductKey: "instruction_pdf",
        improvementActionId: "improvement-1",
      },
    });

    expect(result.url).toBe("https://checkout.stripe.com/c/pay/one-time-session");
    expect(result.id).toBe("cs_test_onetime");
    const [, options] = fetchMock.mock.calls[0]!;
    const params = new URLSearchParams(options.body);
    expect(params.get("mode")).toBe("payment");
    expect(params.get("line_items[0][price]")).toBe("price_instruction_pdf");
    expect(params.get("metadata[clinic_id]")).toBe("clinic-1");
    expect(params.get("metadata[report_id]")).toBe("report-1");
    expect(params.get("metadata[version]")).toBe("1");
    expect(params.get("metadata[option_product_key]")).toBe("instruction_pdf");
    expect(params.get("metadata[improvement_action_id]")).toBe("improvement-1");
    // サブスク用のtax_rates/subscription_dataは一切含めない
    expect(params.has("line_items[0][tax_rates][0]")).toBe(false);
    expect(params.has("subscription_data[metadata][clinic_id]")).toBe(false);
  });

  it("Stripe応答にsession idが無ければエラーにする", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ url: "https://checkout.stripe.com/c/pay/x" }))
    );

    await expect(
      createStripeOneTimeCheckoutSession({
        apiKey: "secret",
        priceId: "price_x",
        clinicId: "clinic-1",
        contactEmail: "owner@example.com",
        appBaseUrl: "https://dent-shift.example.com",
        successPath: "/a",
        cancelPath: "/b",
        metadata: { clinicId: "clinic-1", reportId: "r", version: "1", optionProductKey: "instruction_pdf" },
      })
    ).rejects.toBeInstanceOf(StripeCheckoutProviderError);
  });
});
