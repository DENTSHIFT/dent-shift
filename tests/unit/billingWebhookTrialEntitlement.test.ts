import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 2026-09-27追加、2026-09-28全面修正(PO再指摘): checkout.session.completedの
 * metadataだけを根拠にTrialEntitlementを消費してはならない。Stripe上の
 * Subscription実データ(status="trialing"・trial_start/trial_end・metadata)を
 * 取得・検証してから消費すること、Stripe取得の一時失敗は非2xxで再試行させること、
 * "trial_activated"イベントの二重発火をdedupeKeyで防ぐことを検証する。
 */

const mocks = vi.hoisted(() => {
  class BillingConfigError extends Error {}
  class StripeWebhookVerificationError extends Error {}
  return {
    BillingConfigError,
    StripeWebhookVerificationError,
    resolveConfig: vi.fn(),
    verify: vi.fn(),
    normalize: vi.fn(),
    normalizeOneTime: vi.fn(),
    apply: vi.fn(),
    sendBillingStatusChangeEmail: vi.fn(),
    consumeTrialEntitlementFromWebhook: vi.fn(),
    enqueueIntegrationEvent: vi.fn(),
    activateTrialIfEligible: vi.fn(),
    contactFindMany: vi.fn(),
    retrieveStripeSubscription: vi.fn(),
    scheduleStripeSubscriptionCancellation: vi.fn(),
    syncIntegrationEvent: vi.fn(),
    findPrimaryContactPayloadFields: vi.fn(),
    subscriptionFindUnique: vi.fn(),
  };
});

vi.mock("@/server/config/billingConfig", () => ({
  BillingConfigError: mocks.BillingConfigError,
  resolveBillingConfigFromProcessEnv: mocks.resolveConfig,
}));
vi.mock("@/server/providers/billing/stripeWebhookProvider", () => ({
  StripeWebhookVerificationError: mocks.StripeWebhookVerificationError,
  verifyStripeWebhookEvent: mocks.verify,
  normalizeStripeBillingEvent: mocks.normalize,
  normalizeStripeOneTimePurchaseEvent: mocks.normalizeOneTime,
}));
vi.mock("@/server/db/billingRepository", () => ({
  applyBillingWebhookEvent: mocks.apply,
  findPrimaryContactPayloadFields: mocks.findPrimaryContactPayloadFields,
}));
vi.mock("@/server/services/sendBillingStatusChangeEmail", () => ({
  sendBillingStatusChangeEmail: mocks.sendBillingStatusChangeEmail,
}));
vi.mock("@/server/db/trialEntitlementRepository", () => ({
  consumeTrialEntitlementFromWebhook: mocks.consumeTrialEntitlementFromWebhook,
}));
vi.mock("@/server/db/integrationEventRepository", () => ({
  enqueueIntegrationEvent: mocks.enqueueIntegrationEvent,
}));
vi.mock("@/server/services/activateTrial", () => ({
  activateTrialIfEligible: mocks.activateTrialIfEligible,
}));
vi.mock("@/server/db/prismaClient", () => ({
  prisma: {
    contact: { findMany: mocks.contactFindMany },
    subscription: { findUnique: mocks.subscriptionFindUnique },
  },
}));
vi.mock("@/server/db/optionOrderRepository", () => ({ applyOptionOrderWebhookEvent: vi.fn() }));
vi.mock("@/server/services/optionOrders/generateInstructionPdfArtifact", () => ({
  generateInstructionPdfArtifact: vi.fn(),
}));
vi.mock("@/server/db/inviteRepository", () => ({
  consumeInviteForClinic: vi.fn(),
  getInviteById: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/domain/invite/inviteCode", () => ({ computeInviteCancelAtEpochSeconds: vi.fn() }));
vi.mock("@/server/providers/billing/stripeCheckoutProvider", () => ({
  scheduleStripeSubscriptionCancellation: mocks.scheduleStripeSubscriptionCancellation,
  retrieveStripeSubscription: mocks.retrieveStripeSubscription,
}));
vi.mock("@/server/services/salesforceSync", () => ({
  syncIntegrationEvent: mocks.syncIntegrationEvent,
}));

import { POST } from "@/app/api/billing/webhook/route";

const STRIPE_CONFIG = {
  provider: "stripe",
  apiKey: "sk_test_secret",
  webhookSecret: "whsec_secret",
  appBaseUrl: "https://dent-shift.example.com",
  priceLabels: { light: "L", standard: "S", premium: "P" },
  stripePriceIds: { light: "price_l", standard: "price_s", premium: "price_p" },
};

function request() {
  const headers = new Headers({ "content-type": "application/json", "stripe-signature": "signed" });
  return new Request("https://dent-shift.example.com/api/billing/webhook", {
    method: "POST",
    headers,
    body: '{"raw": true}',
  });
}

const CHECKOUT_COMMAND = {
  providerEventId: "evt_trial_checkout",
  eventType: "checkout.session.completed",
  occurredAt: new Date("2026-09-27T00:00:00Z"),
  action: {
    kind: "checkout_completed" as const,
    identity: {
      externalSubscriptionId: "sub_trial_1",
      clinicId: "clinic-1",
      plan: "light" as const,
      trialEntitlementId: "entitlement-1",
    },
    initialStatus: "trial" as const,
    checkoutSessionId: "cs_trial_1",
  },
};

// 実際にStripe上でtrialingになった、と検証を通過するSubscriptionスナップショット。
const VERIFIED_TRIALING_SUBSCRIPTION = {
  id: "sub_trial_1",
  status: "trialing",
  trialStart: new Date("2026-09-27T00:00:00Z"),
  trialEnd: new Date("2026-10-04T00:00:00Z"),
  metadataClinicId: "clinic-1",
  metadataTrialEntitlementId: "entitlement-1",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveConfig.mockReturnValue(STRIPE_CONFIG);
  mocks.verify.mockReturnValue({
    id: "evt_trial_checkout",
    type: "checkout.session.completed",
    data: { object: { subscription: "sub_trial_1" } },
  });
  mocks.normalize.mockReturnValue(CHECKOUT_COMMAND);
  mocks.apply.mockResolvedValue({ result: "processed", notify: null, trialActivated: null });
  mocks.retrieveStripeSubscription.mockResolvedValue(VERIFIED_TRIALING_SUBSCRIPTION);
  mocks.consumeTrialEntitlementFromWebhook.mockResolvedValue({
    result: "consumed",
    trialActivatedNow: true,
    integrationEventId: "integration-event-1",
  });
  mocks.syncIntegrationEvent.mockResolvedValue(undefined);
  mocks.enqueueIntegrationEvent.mockResolvedValue(undefined);
  mocks.activateTrialIfEligible.mockResolvedValue(undefined);
  mocks.contactFindMany.mockResolvedValue([]);
  mocks.findPrimaryContactPayloadFields.mockResolvedValue({ contactId: null, consentAcceptedAt: null });
  mocks.subscriptionFindUnique.mockResolvedValue({ plan: "light" });
});

describe("POST /api/billing/webhook: TrialEntitlement消費(Stripe実データ検証あり)", () => {
  it("Stripe上で実際にtrialingと検証できた場合のみ、3-way突合の全パラメータを渡してconsumeを呼ぶ", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.retrieveStripeSubscription).toHaveBeenCalledWith({
      apiKey: "sk_test_secret",
      subscriptionId: "sub_trial_1",
    });
    expect(mocks.consumeTrialEntitlementFromWebhook).toHaveBeenCalledWith({
      trialEntitlementId: "entitlement-1",
      clinicId: "clinic-1",
      checkoutSessionId: "cs_trial_1",
      externalSubscriptionId: "sub_trial_1",
      occurredAt: CHECKOUT_COMMAND.occurredAt,
    });
  });

  it("metadataではtrial表記だが、Subscriptionが実際はactiveの場合は消費しない", async () => {
    mocks.retrieveStripeSubscription.mockResolvedValue({
      ...VERIFIED_TRIALING_SUBSCRIPTION,
      status: "active",
    });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.consumeTrialEntitlementFromWebhook).not.toHaveBeenCalled();
  });

  it("Subscriptionが存在しない(404相当のnull)場合は消費しない", async () => {
    mocks.retrieveStripeSubscription.mockResolvedValue(null);
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.consumeTrialEntitlementFromWebhook).not.toHaveBeenCalled();
  });

  it("Subscriptionのmetadataがtrial_entitlement_idと不一致なら消費しない", async () => {
    mocks.retrieveStripeSubscription.mockResolvedValue({
      ...VERIFIED_TRIALING_SUBSCRIPTION,
      metadataTrialEntitlementId: "different-entitlement",
    });
    await POST(request());
    expect(mocks.consumeTrialEntitlementFromWebhook).not.toHaveBeenCalled();
  });

  it("trial_start/trial_endが両方とも無い場合は消費しない(trialing表記だけでは不十分)", async () => {
    mocks.retrieveStripeSubscription.mockResolvedValue({
      ...VERIFIED_TRIALING_SUBSCRIPTION,
      trialStart: null,
      trialEnd: null,
    });
    await POST(request());
    expect(mocks.consumeTrialEntitlementFromWebhook).not.toHaveBeenCalled();
  });

  it("Stripe取得が一時的に失敗した場合は消費せず、非2xxを返しStripeに再送させる(永久欠落を防ぐ)", async () => {
    mocks.retrieveStripeSubscription.mockRejectedValue(new Error("network error"));
    const response = await POST(request());
    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(mocks.consumeTrialEntitlementFromWebhook).not.toHaveBeenCalled();
  });

  it("trialEntitlementIdが無いcheckout_completed(即時課金等)ではStripe取得も消費も行わない", async () => {
    mocks.normalize.mockReturnValue({
      ...CHECKOUT_COMMAND,
      action: {
        ...CHECKOUT_COMMAND.action,
        identity: { ...CHECKOUT_COMMAND.action.identity, trialEntitlementId: undefined },
      },
    });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.retrieveStripeSubscription).not.toHaveBeenCalled();
    expect(mocks.consumeTrialEntitlementFromWebhook).not.toHaveBeenCalled();
  });

  it("metadata不一致等でconsumeがnot_found_or_mismatchを返しても、Webhook応答自体は200のまま(Stripeへ再送させない)", async () => {
    mocks.consumeTrialEntitlementFromWebhook.mockResolvedValue({
      result: "not_found_or_mismatch",
      trialActivatedNow: false,
      integrationEventId: null,
    });
    const response = await POST(request());
    expect(response.status).toBe(200);
  });

  it("2026-09-28修正(PO再指摘): consumeTrialEntitlementFromWebhookのDB例外(接続断・deadlock等)は握り潰さず、非2xxを返してStripeに再送させる(200での永久欠落を禁止)", async () => {
    mocks.consumeTrialEntitlementFromWebhook.mockRejectedValue(new Error("db down"));
    const response = await POST(request());
    expect(response.status).toBeGreaterThanOrEqual(500);
  });

  it("消費成功時、新規作成されたtrial_activated IntegrationEventのみSalesforce同期を試行する", async () => {
    await POST(request());
    expect(mocks.syncIntegrationEvent).toHaveBeenCalledWith("integration-event-1");
  });

  it("dedupeによりintegrationEventIdがnull(既に別経路が記録済み)の場合は同期を試行しない", async () => {
    mocks.consumeTrialEntitlementFromWebhook.mockResolvedValue({
      result: "consumed",
      trialActivatedNow: true,
      integrationEventId: null,
    });
    await POST(request());
    expect(mocks.syncIntegrationEvent).not.toHaveBeenCalled();
  });

  it("2026-09-28追加(PO再指摘、DB記録と外部同期の分離): trial_activatedのDB記録(consume)が成功していれば、その後のSalesforce同期が失敗してもWebhook応答は200のまま(再送させない。失敗したイベントは既存の再試行ジョブに委ねる)", async () => {
    mocks.syncIntegrationEvent.mockRejectedValue(new Error("salesforce timeout"));
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.syncIntegrationEvent).toHaveBeenCalledWith("integration-event-1");
  });

  it("既存のtrialActivated(Subscription状態遷移検知)はdedupeKey付きでenqueueIntegrationEventを呼ぶ(こちらの経路とdedupeKeyが揃う)", async () => {
    mocks.apply.mockResolvedValue({
      result: "processed",
      notify: null,
      trialActivated: { clinicId: "clinic-1", externalSubscriptionId: "sub_trial_1" },
    });
    await POST(request());
    expect(mocks.enqueueIntegrationEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "trial_activated",
        dedupeKey: "trial_activated:sub_trial_1",
      })
    );
  });

  it("2026-09-29追加(PO承認、Salesforce連携P0-2): trial_activatedのpayloadにContact ID・プラン・同意日時・契約状態を含める", async () => {
    mocks.apply.mockResolvedValue({
      result: "processed",
      notify: null,
      trialActivated: { clinicId: "clinic-1", externalSubscriptionId: "sub_trial_1" },
    });
    mocks.findPrimaryContactPayloadFields.mockResolvedValue({
      contactId: "contact-1",
      consentAcceptedAt: "2026-09-01T00:00:00.000Z",
    });
    mocks.subscriptionFindUnique.mockResolvedValue({ plan: "standard" });

    await POST(request());

    expect(mocks.enqueueIntegrationEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "trial_activated",
        contactId: "contact-1",
        payload: {
          contact_id: "contact-1",
          consent_accepted_at: "2026-09-01T00:00:00.000Z",
          plan: "standard",
          status: "trial",
        },
      })
    );
  });
});
