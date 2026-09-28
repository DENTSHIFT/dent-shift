import type { PlanId } from "./planCatalog";
import type { SubscriptionStatus } from "./subscriptionStatus";

export interface BillingWebhookIdentity {
  externalSubscriptionId: string;
  clinicId: string | null;
  plan: PlanId | null;
  // 2026-09-22: 知人院長向け1円招待モニター経由のcheckoutで付与される(通常契約は未設定)。
  // 通常のplan/価格ロジックには一切関与せず、Subscription.inviteId・Invite消費の
  // トレーサビリティ専用。既存の呼び出し元を壊さないようoptionalにする。
  inviteId?: string | null;
  inviteCode?: string | null;
  // 2026-09-27追加(PO承認、P0-Checkout接続): トライアル対象Checkoutでのみ設定される
  // (通常のsubscription_status/invoiceイベントには含まれない)。TrialEntitlementの
  // 消費確定(webhook route参照)を、clinicIdだけでなくこのIDとcheckoutSessionIdの
  // 3-way突合で行う。
  trialEntitlementId?: string | null;
}

export type BillingWebhookAction =
  | {
      kind: "checkout_completed";
      identity: BillingWebhookIdentity;
      initialStatus: "trial" | "active";
      // 2026-09-27追加(PO承認、P0-Checkout接続): このCheckout Session自身のID。
      // TrialEntitlement消費の3-way突合(trialEntitlementId・clinicId・
      // checkoutSessionId)に使う。
      checkoutSessionId: string;
    }
  | {
      kind: "subscription_status";
      identity: BillingWebhookIdentity;
      status: SubscriptionStatus;
      // Stripe Subscriptionのtrial_start/trial_end(2026-09-25)。トライアルの正本はStripe。
      // トライアルが無い契約(プレミアム等)ではnull。
      trialStartedAt?: Date | null;
      trialEndsAt?: Date | null;
    }
  // 2026-09-25: invoiceイベントはPayment履歴の記録専用。契約状態(status)の正本には使わない
  // (¥0のトライアル開始invoiceでもinvoice.paidが発火し、trialing→activeへ誤上書きされていた)。
  | {
      kind: "invoice_status";
      identity: BillingWebhookIdentity;
      paymentStatus: "paid" | "failed";
      externalPaymentId: string;
    }
  | { kind: "ignored" };

export interface BillingWebhookCommand {
  providerEventId: string;
  eventType: string;
  occurredAt: Date;
  action: BillingWebhookAction;
}

// "retry": 契約がまだ作られていない段階でinvoiceイベントが先着した場合(Stripeは
// invoice.paidをsubscription.createdとほぼ同時に送る)。イベントを処理済みとして記録せず、
// Webhookにエラー応答を返してStripeに再送させる(Payment履歴を取りこぼさないため)。
export type BillingWebhookApplyResult = "processed" | "ignored" | "duplicate" | "retry";

/**
 * 2026-09-23: 契約状態が実際に悪化方向へ遷移した場合のみ、呼び出し側(webhook route)へ
 * 通知メール送信のトリガーを返す。Stripe Webhookの再送(同一providerEventIdの重複)は
 * applyBillingWebhookEvent側の一意制約で"duplicate"として弾かれるため、ここに到達する
 * 時点で新規イベントであることは保証されている。さらに「更新前後でstatusが実際に
 * 変化した場合のみ」に絞ることで、同一状態を繰り返し報告するイベント(例: 複数回の
 * invoice.payment_failed)による通知の重複送信を防ぐ(冪等性の担保)。
 */
export interface BillingStatusNotification {
  clinicId: string;
  toStatus: SubscriptionStatus;
}

// 2026-09-28修正(PO再指摘): trial_activatedイベントのdedupeキーに使うため
// externalSubscriptionIdを併せて返す。TrialEntitlement消費経路(webhook route)側の
// trial_activated記録も同じdedupeキー(`trial_activated:${externalSubscriptionId}`)を
// 使うことで、どちらのWebhookが先に到達しても最終的にイベントが1件だけになる
// (IntegrationEvent.dedupeKeyのDB一意制約が最終防衛線)。
export interface TrialActivatedSignal {
  clinicId: string;
  externalSubscriptionId: string;
}

// 2026-09-28追加(PO承認、P1-4「有料契約への移行」): trial_activatedと同じ根拠
// (Stripe Webhookの確定情報、ブラウザの自己申告ではない)でstatusが実際にactiveへ
// 遷移した場合のシグナル。dedupeKey(`subscription_activated:${externalSubscriptionId}`)
// のDBユニーク制約により、同一Subscriptionにつき生涯1件だけ記録される
// (past_due→active等の復帰では、IntegrationEvent自体は新規作成されないが、
// このシグナル自体はStripeの確定情報どおりtrueを返す。実際に新規記録されたかは
// integrationEventIdがnullかどうかで判別する、billingRepository.ts参照)。
export interface SubscriptionActivatedSignal {
  clinicId: string;
  externalSubscriptionId: string;
  plan: PlanId;
  // 遷移前のstatus(初回のSubscription作成時はnull)。
  fromStatus: SubscriptionStatus | null;
  // トライアル経由でのactive化か(trialStartedAtが設定されているか)。
  viaTrial: boolean;
}

// 2026-09-29追加(PO承認、Salesforce連携P0-2): subscriptionActivatedと同じ根拠
// (Stripe Webhookの確定情報)でstatusが実際に"cancelled"へ遷移した場合のシグナル。
// dedupeKey(`subscription_canceled:${externalSubscriptionId}`)のDBユニーク制約により、
// 同一Subscriptionにつき生涯1件だけ記録される("cancelled"は終端状態のため再遷移はない)。
export interface SubscriptionCanceledSignal {
  clinicId: string;
  externalSubscriptionId: string;
  plan: PlanId;
  // 遷移前のstatus。
  fromStatus: SubscriptionStatus;
}

export interface BillingWebhookApplyOutcome {
  result: BillingWebhookApplyResult;
  notify: BillingStatusNotification | null;
  // 2026-09-27追加(PO承認、第1段階の計測強化): Stripe Webhookの確定情報により、
  // このイベント処理でSubscription.statusが(trial以外)→trialへ実際に遷移した場合のみ
  // true。ブラウザからの自己申告ではなく、Stripeからのサーバー間通知を根拠とする。
  // 同一Webhookイベントの再送はproviderEventIdの一意制約で"duplicate"として弾かれ、
  // 別イベントでも遷移が起きていなければfalseになるため、二重発火しない。
  trialActivated: TrialActivatedSignal | null;
  // 2026-09-28追加(PO承認、P1-4): Subscription.statusが実際に(active以外)→activeへ
  // 遷移した場合のシグナル。trial経由・トライアルなし初回activeの両方を対象とする。
  subscriptionActivated: SubscriptionActivatedSignal | null;
  // 上のsubscriptionActivatedに伴い、同一トランザクション内で新規作成された
  // "subscription_activated" IntegrationEvent行のid。dedupeにより新規作成されなかった
  // 場合(=既にその契約の初回active化が記録済み)はnull。呼び出し元(webhook route)が
  // 新規作成された場合のみベストエフォートでSalesforce同期を1回試行するために使う。
  subscriptionActivatedIntegrationEventId: string | null;
  // 2026-09-29追加(PO承認、Salesforce連携P0-2): 解約(cancelled)への実際の遷移シグナル。
  // subscriptionActivatedと同じ設計(dedupeによりSubscriptionにつき生涯1件)。
  subscriptionCanceled: SubscriptionCanceledSignal | null;
  // 上のsubscriptionCanceledに伴い、同一トランザクション内で新規作成された
  // "subscription_canceled" IntegrationEvent行のid。新規作成されなかった場合はnull。
  subscriptionCanceledIntegrationEventId: string | null;
}
