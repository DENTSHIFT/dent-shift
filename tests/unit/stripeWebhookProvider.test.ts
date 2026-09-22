import { describe, expect, it } from "vitest";
import Stripe from "stripe";
import {
  normalizeStripeBillingEvent,
  normalizeStripeOneTimePurchaseEvent,
  StripeWebhookVerificationError,
  verifyStripeWebhookEvent,
} from "@/server/providers/billing/stripeWebhookProvider";

const stripe = new Stripe("sk_test_for_signature_only");

function event(type: string, object: Record<string, unknown>, id = "evt_test_1") {
  return {
    id,
    object: "event",
    type,
    created: 1_788_969_600,
    data: { object },
  } as unknown as Stripe.Event;
}

describe("Stripe webhook signature verification", () => {
  it("raw本文と正しい署名だけを受け付ける", () => {
    const payload = JSON.stringify(event("test.event", { id: "obj_1" }));
    const secret = "whsec_test_only";
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret });

    expect(
      verifyStripeWebhookEvent({
        payload,
        signature,
        apiKey: "sk_test_for_signature_only",
        webhookSecret: secret,
      }).id
    ).toBe("evt_test_1");
  });

  it("改ざんされた本文を拒否し、秘密値を例外へ含めない", () => {
    const payload = JSON.stringify(event("test.event", { id: "obj_1" }));
    const secret = "whsec_must_not_leak";
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret });

    let caught: unknown;
    try {
      verifyStripeWebhookEvent({
        payload: `${payload} `,
        signature,
        apiKey: "sk_test_must_not_leak",
        webhookSecret: secret,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(StripeWebhookVerificationError);
    expect((caught as Error).message).not.toContain(secret);
    expect((caught as Error).message).not.toContain("sk_test_must_not_leak");
  });
});

describe("Stripe billing event normalization", () => {
  it("完了したCheckoutを医院・プラン・契約IDへ結び付ける(即時課金=amount_total>0はactive、プレミアム相当)", () => {
    const command = normalizeStripeBillingEvent(
      event("checkout.session.completed", {
        id: "cs_test_1",
        client_reference_id: "clinic-1",
        subscription: "sub_1",
        payment_status: "paid",
        amount_total: 79800,
        metadata: { clinic_id: "clinic-1", plan: "premium" },
      })
    );
    expect(command.action).toEqual({
      kind: "checkout_completed",
      identity: {
        externalSubscriptionId: "sub_1",
        clinicId: "clinic-1",
        plan: "premium",
        inviteId: null,
        inviteCode: null,
      },
      initialStatus: "active",
    });
  });

  it("trial_period_days付きのCheckout(amount_total=0)はtrialにする。ライト/スタンダード相当。2026-09-22の手動E2Eで発見したバグの修正: Stripeはtrial中の$0請求でもpayment_status='paid'を返すため、payment_statusだけで判定すると初日からactive扱いになってしまう", () => {
    const command = normalizeStripeBillingEvent(
      event("checkout.session.completed", {
        id: "cs_test_trial",
        client_reference_id: "clinic-1",
        subscription: "sub_1",
        payment_status: "paid",
        amount_total: 0,
        metadata: { clinic_id: "clinic-1", plan: "light" },
      })
    );
    expect(command.action).toEqual({
      kind: "checkout_completed",
      identity: {
        externalSubscriptionId: "sub_1",
        clinicId: "clinic-1",
        plan: "light",
        inviteId: null,
        inviteCode: null,
      },
      initialStatus: "trial",
    });
  });

  it("招待経由(invite_code/invite_id)のcheckout.session.completedはidentityへ引き継がれる(2026-09-22の1円招待モニター)", () => {
    const command = normalizeStripeBillingEvent(
      event("checkout.session.completed", {
        id: "cs_test_invite",
        client_reference_id: "clinic-1",
        subscription: "sub_invite",
        payment_status: "paid",
        amount_total: 1,
        metadata: { clinic_id: "clinic-1", plan: "standard", invite_code: "ABC123", invite_id: "invite-1" },
      })
    );
    expect(command.action).toEqual({
      kind: "checkout_completed",
      identity: {
        externalSubscriptionId: "sub_invite",
        clinicId: "clinic-1",
        plan: "standard",
        inviteId: "invite-1",
        inviteCode: "ABC123",
      },
      initialStatus: "active",
    });
  });

  it("amount_totalが無い(想定外の応答形)場合は安全側のtrialにする", () => {
    const command = normalizeStripeBillingEvent(
      event("checkout.session.completed", {
        id: "cs_test_no_amount",
        client_reference_id: "clinic-1",
        subscription: "sub_1",
        payment_status: "paid",
        metadata: { clinic_id: "clinic-1", plan: "standard" },
      })
    );
    expect(command.action).toEqual(
      expect.objectContaining({ initialStatus: "trial" })
    );
  });

  it("現行Invoiceのsubscription_detailsから支払い成功を取り出す", () => {
    const command = normalizeStripeBillingEvent(
      event("invoice.paid", {
        id: "in_1",
        parent: {
          type: "subscription_details",
          subscription_details: {
            subscription: "sub_1",
            metadata: { clinic_id: "clinic-1", plan: "standard" },
          },
        },
      })
    );
    expect(command.action).toEqual({
      kind: "invoice_status",
      identity: {
        externalSubscriptionId: "sub_1",
        clinicId: "clinic-1",
        plan: "standard",
        inviteId: null,
        inviteCode: null,
      },
      status: "active",
      paymentStatus: "paid",
      externalPaymentId: "in_1",
    });
  });

  it("支払い失敗はpast_dueへ変換する", () => {
    const command = normalizeStripeBillingEvent(
      event("invoice.payment_failed", {
        id: "in_failed",
        parent: {
          subscription_details: {
            subscription: { id: "sub_1" },
            metadata: { clinic_id: "clinic-1", plan: "light" },
          },
        },
      })
    );
    expect(command.action).toEqual(
      expect.objectContaining({
        kind: "invoice_status",
        status: "past_due",
        paymentStatus: "failed",
      })
    );
  });

  it("医院IDが一致しないCheckoutと未対応イベントは安全に無視する", () => {
    expect(
      normalizeStripeBillingEvent(
        event("checkout.session.completed", {
          client_reference_id: "clinic-other",
          subscription: "sub_1",
          metadata: { clinic_id: "clinic-1", plan: "standard" },
        })
      ).action
    ).toEqual({ kind: "ignored" });
    expect(normalizeStripeBillingEvent(event("charge.succeeded", { id: "ch_1" })).action).toEqual({
      kind: "ignored",
    });
  });

  it("subscriptionを持つcheckout.session.completedは単発購入として扱わない(相互排他)", () => {
    const oneTime = normalizeStripeOneTimePurchaseEvent(
      event("checkout.session.completed", {
        id: "cs_test_1",
        client_reference_id: "clinic-1",
        subscription: "sub_1",
        payment_status: "paid",
        metadata: { clinic_id: "clinic-1", report_id: "report-1", version: "1", option_product_key: "instruction_pdf" },
      })
    );
    expect(oneTime.action).toEqual({ kind: "ignored" });
  });
});

describe("Stripe one-time purchase event normalization(制作会社向け修正指示書等)", () => {
  it("mode=payment(subscriptionなし)のcheckout.session.completedをOptionOrder購入として正規化する", () => {
    const command = normalizeStripeOneTimePurchaseEvent(
      event("checkout.session.completed", {
        id: "cs_test_onetime",
        client_reference_id: "clinic-1",
        payment_status: "paid",
        payment_intent: { id: "pi_test_1" },
        amount_total: 3300,
        metadata: {
          clinic_id: "clinic-1",
          report_id: "report-1",
          version: "1",
          option_product_key: "instruction_pdf",
          improvement_action_id: "improvement-1",
        },
      })
    );
    expect(command.action).toEqual({
      kind: "one_time_paid",
      identity: {
        stripeCheckoutSessionId: "cs_test_onetime",
        clinicId: "clinic-1",
        reportId: "report-1",
        version: 1,
        optionProductKey: "instruction_pdf",
        improvementActionKey: "improvement-1",
      },
      stripePaymentIntentId: "pi_test_1",
      amountTotalJpy: 3300,
    });
  });

  it("未決済(payment_status!=paid)は無視する", () => {
    const command = normalizeStripeOneTimePurchaseEvent(
      event("checkout.session.completed", {
        id: "cs_test_unpaid",
        client_reference_id: "clinic-1",
        payment_status: "unpaid",
        metadata: { clinic_id: "clinic-1", report_id: "report-1", version: "1", option_product_key: "instruction_pdf" },
      })
    );
    expect(command.action).toEqual({ kind: "ignored" });
  });

  it("client_reference_idとmetadata.clinic_idが一致しない場合は無視する(なりすまし対策)", () => {
    const command = normalizeStripeOneTimePurchaseEvent(
      event("checkout.session.completed", {
        id: "cs_test_mismatch",
        client_reference_id: "clinic-other",
        payment_status: "paid",
        metadata: { clinic_id: "clinic-1", report_id: "report-1", version: "1", option_product_key: "instruction_pdf" },
      })
    );
    expect(command.action).toEqual({ kind: "ignored" });
  });

  it("checkout.session.completed以外のイベントは無視する", () => {
    expect(normalizeStripeOneTimePurchaseEvent(event("charge.succeeded", { id: "ch_1" })).action).toEqual({
      kind: "ignored",
    });
  });
});
