import { isTrialEligiblePlan } from "./trialActivation";
import { hasExistingSubscription, type SubscriptionStatus } from "./subscriptionStatus";
import type { PlanId } from "./planCatalog";

// 2026-09-27追加(PO承認、P0): TrialEntitlement.statusの許容値。既存のSubscriptionStatus等と
// 同じ方針(SQLite/Postgres両対応のためPrisma純正enumではなくString+検証関数)。
export const TRIAL_ENTITLEMENT_STATUSES = ["reserved", "consumed", "released"] as const;
export type TrialEntitlementStatus = (typeof TRIAL_ENTITLEMENT_STATUSES)[number];

export function isTrialEntitlementStatus(value: string): value is TrialEntitlementStatus {
  return TRIAL_ENTITLEMENT_STATUSES.includes(value as TrialEntitlementStatus);
}

// 許可する遷移は reserved→consumed / reserved→released のみ。それ以外(同一状態への
// 自己遷移も含む)は拒否する。既存の状態を無条件で上書きしないための単一の関所。
const ALLOWED_TRIAL_ENTITLEMENT_TRANSITIONS: Record<
  TrialEntitlementStatus,
  readonly TrialEntitlementStatus[]
> = {
  reserved: ["consumed", "released"],
  consumed: [],
  released: [],
};

export function canTransitionTrialEntitlement(
  from: TrialEntitlementStatus,
  to: TrialEntitlementStatus
): boolean {
  return ALLOWED_TRIAL_ENTITLEMENT_TRANSITIONS[from].includes(to);
}

// Checkout Session作成前(Stripeへ到達する前)の暫定的な予約有効期限。Stripeが実際の
// Sessionを発行した後は、そのSession自身のexpires_atへ差し替える(attachStripeSession)。
// この短いTTLは「Stripe呼び出し中にプロセスが落ちた」場合に、幽霊予約が長時間
// 部分ユニークインデックスを占有し続けないようにするためのもの。
export const RESERVATION_PENDING_TTL_MS = 10 * 60 * 1000; // 10分

export function computePendingReservationExpiry(now: Date): Date {
  return new Date(now.getTime() + RESERVATION_PENDING_TTL_MS);
}

// 2026-09-28追加(PO再指摘、期限境界の統一): 「有効」と「期限切れ」の境界を
// 単一の定義に統一する。`reservationExpiresAt > now` を有効、`<= now`(ちょうど
// 同時刻を含む)を期限切れとする。この関数を使わずに`gte`/`lt`等をリポジトリの
// 複数箇所に書くと、境界(ちょうど同時刻)の扱いが箇所ごとに矛盾しうるため、
// 判定・Prismaクエリ条件の両方でこの1箇所だけを正とする。
export function isReservationStillValid(reservationExpiresAt: Date, now: Date): boolean {
  return reservationExpiresAt.getTime() > now.getTime();
}

// UI/APIで共有する「そのプランがトライアル対象か」の単一の判定。
// trialActivation.tsのisTrialEligiblePlanをそのまま再エクスポートし、対象プラン一覧の
// 定義箇所を1つに保つ(PO指示: isTrialPlan/isClinicTrialEligible/canStartCheckoutの分離)。
export function isTrialPlan(planId: string): boolean {
  return isTrialEligiblePlan(planId);
}

// UI/APIで共有する「この医院がまだ無料トライアルを消費していないか」の単一の判定。
// Clinic.trialConsumedAtが恒久的な正本(Stripe Webhookで実際にtrialへ遷移した時のみ設定)。
export function isClinicTrialEligible(clinic: { trialConsumedAt: Date | null }): boolean {
  return clinic.trialConsumedAt === null;
}

// UI/APIで共有する「新規Checkoutを開始できるか」の単一の判定(既存契約の有無のみで決まる。
// トライアル可否とは独立した軸)。既存のsubscriptionStatus.tsのhasExistingSubscription()を
// そのまま再利用し、判定ロジックの重複を避ける。
export function canStartCheckout(
  subscription: { status: string; billingExempt: boolean } | null
): boolean {
  return !hasExistingSubscription(subscription);
}

export interface TrialTerms {
  // このCheckoutで実際にトライアルを付与するか(プラン対象 かつ 医院が未消費の場合のみ)。
  trialEligible: boolean;
  // トライアル消費済み等でも、対象外プランとしてのフル契約自体は妨げない
  // (PO指示: 「Premiumなどトライアル対象外プランの通常契約は、トライアル消費済みでも契約可能」)。
  ctaLabel: "7日間無料で試す" | "このプランで契約する";
}

/**
 * プラン・医院の状態から、CTA表示とCheckout時のトライアル付与可否をまとめて解決する。
 * 「未契約」であることと「無料トライアル対象であること」を別状態として扱う
 * (PO指示7)。isClinicTrialEligible=falseでも、対象外プランとしての契約自体は
 * 常に可能なままにする。
 */
export function resolveTrialTerms(input: {
  plan: PlanId;
  clinic: { trialConsumedAt: Date | null };
}): TrialTerms {
  const trialEligible = isTrialPlan(input.plan) && isClinicTrialEligible(input.clinic);
  return {
    trialEligible,
    ctaLabel: trialEligible ? "7日間無料で試す" : "このプランで契約する",
  };
}

// canStartCheckoutと同じ入力形状を明示的な型として公開する(呼び出し側の型注釈用)。
export type CheckoutBlockingSubscription = { status: SubscriptionStatus; billingExempt: boolean };

// 2026-09-28追加(PO再指摘): checkout.session.completedのmetadataだけを根拠に
// TrialEntitlementを消費してはならない(Session側のmetadataは「意図」であって
// Stripe上で実際にtrialingになった証明にはならない)。Stripeから取得した
// Subscriptionの実データ(status/trial_start/trial_end/metadata)を検証してから
// 消費する。この関数は純粋関数とし、実際のStripe API呼び出し(retrieveStripeSubscription)
// とは分離する(テスト容易性・呼び出し元の責務分離のため)。
export interface StripeSubscriptionSnapshotForConsumption {
  status: string;
  trialStart: Date | null;
  trialEnd: Date | null;
  metadataClinicId: string | null;
  metadataTrialEntitlementId: string | null;
}

// 2026-09-28追加(PO再指摘、CTA判定を先送りしない): 「未契約」の中でも
// 実際の状態が異なる4つを区別してCTA文言を出し分ける。ページ表示時にStripe APIを
// 呼ぶ必要はなく、DBに保存済みのTrialEntitlement/Clinic.trialConsumedAtの状態のみで
// 判定する(最終的な真偽はCheckout API側のreserveTrialEntitlement()が必ず再検証する
// ため、ここでの判定は「表示」の精度を上げるためのものであり、セキュリティ境界ではない)。
export type TrialCtaLabel =
  | "7日間無料で試す"
  | "無料トライアルの手続きを続ける"
  | "手続きを準備中"
  | "このプランで契約する";

export interface ClinicTrialCheckoutSnapshot {
  // Clinic.trialConsumedAt(一方向、Webhook確定でのみ設定)。
  trialConsumedAt: Date | null;
  // 防御的二重チェック: status="consumed"のTrialEntitlementが存在するか
  // (通常はtrialConsumedAtと同時に設定されるが、独立した signal として確認する)。
  hasConsumedEntitlement: boolean;
  // 有効な(期限切れでない)status="reserved"の予約。nullなら無し。
  activeReservation: { hasCheckoutSession: boolean } | null;
}

export function resolveTrialCtaLabel(input: {
  plan: string;
  clinic: ClinicTrialCheckoutSnapshot;
  // 2026-09-28追加(PO再指摘): 新規Checkoutを禁止する既存Subscription状態
  // (trial/active/past_due/restricted/suspended/cancel_scheduled等、subscriptionStatus.ts
  // のhasExistingSubscription()参照)がある場合は、トライアル関連のCTAを一切出さず、
  // 常に「このプランで契約する」を返す(この医院のトライアル消費有無によらず優先する)。
  // 呼び出し元(/plansページ)が個別にhasExistingSubscriptionで分岐する実装だと、
  // 分岐順序を誤ったときに誤表示が発生しうるため、この関数自身の必須引数として
  // 組み込み、単一のテスト対象にする。
  hasExistingSubscription: boolean;
}): TrialCtaLabel {
  if (input.hasExistingSubscription) return "このプランで契約する";
  if (!isTrialPlan(input.plan)) return "このプランで契約する";
  if (input.clinic.trialConsumedAt !== null || input.clinic.hasConsumedEntitlement) {
    return "このプランで契約する";
  }
  if (input.clinic.activeReservation) {
    return input.clinic.activeReservation.hasCheckoutSession
      ? "無料トライアルの手続きを続ける"
      : "手続きを準備中";
  }
  return "7日間無料で試す";
}

// 2026-09-28追加(PO再指摘、CTA矛盾の解消): 「押すと409になるボタンを表示しない」ことを
// コード・テストで保証するため、/plansページのCTA全体を1つの判別可能な状態として解決する。
// 各状態はラベルだけでなく「リンク先」「実際にCheckoutを許可するか」まで含み、
// PlanAction()コンポーネント側はこの状態を機械的に描画するだけにする(条件分岐の重複・
// 表示とAPI許可条件のズレを構造的に防ぐ)。
export type PlanActionState =
  | { kind: "login_required" }
  | { kind: "checkout_not_ready" }
  | { kind: "billing_exempt" }
  | { kind: "current_plan" }
  | { kind: "upgrade"; targetPlan: "standard" | "premium" }
  // 新規Checkoutを禁止する既存Subscription状態(trial/active/past_due/restricted/
  // suspended/cancel_scheduled)で、現在のプランでもアップグレード対象でもない場合。
  // Checkout CTAを一切出さず、契約状況の確認へ誘導する(押すと409になるボタンを
  // 表示しない、PO指示2)。
  | { kind: "manage_existing" }
  | { kind: "start_trial" } // 「7日間無料で試す」
  | { kind: "continue_session" } // 「無料トライアルの手続きを続ける」
  | { kind: "preparing" } // 「手続きを準備中」
  | { kind: "contract" } // 「このプランで契約する」(新規、トライアル対象外 or 消費済み)
  | { kind: "recontract" }; // 「このプランで再契約する」(cancelled かつ トライアル消費済み)

/**
 * /plansページのCTA全体を解決する。呼び出し元はこの関数の戻り値だけを見て描画すればよく、
 * hasExistingSubscription等を個別に再判定しない(判定順序を誤って「押すと409になる
 * ボタン」を表示してしまう事故を構造的に防ぐ、PO再指摘)。
 * Checkout APIの最終的な許可条件はreserveTrialEntitlement()/canStartCheckout()側で
 * 必ず再検証される。ここでの判定はStripe APIを呼ばず、DB保存済みの状態のみで行う。
 */
export function resolvePlanActionState(input: {
  plan: PlanId;
  currentPlan: PlanId | null;
  authenticated: boolean;
  checkoutReady: boolean;
  isBillingExempt: boolean;
  // 医院の現在の契約状態(一度も契約したことがなければnull)。
  subscriptionStatus: SubscriptionStatus | null;
  // 上位プランへのアップグレードが許可されるか(planUpgrade.ts参照、既存機能)。
  upgradeAllowed: boolean;
  // 未ログインの場合はnull。
  clinic: ClinicTrialCheckoutSnapshot | null;
}): PlanActionState {
  if (input.isBillingExempt) return { kind: "billing_exempt" };

  const blocksNewCheckout =
    input.subscriptionStatus !== null && hasExistingSubscription({
      status: input.subscriptionStatus,
      billingExempt: false,
    });

  if (blocksNewCheckout) {
    if (input.plan === input.currentPlan) return { kind: "current_plan" };
    if (input.upgradeAllowed && (input.plan === "standard" || input.plan === "premium")) {
      return { kind: "upgrade", targetPlan: input.plan };
    }
    return { kind: "manage_existing" };
  }

  if (!input.checkoutReady) return { kind: "checkout_not_ready" };
  if (!input.authenticated || !input.clinic) return { kind: "login_required" };

  if (input.clinic.activeReservation) {
    return input.clinic.activeReservation.hasCheckoutSession
      ? { kind: "continue_session" }
      : { kind: "preparing" };
  }

  const trialConsumed = input.clinic.trialConsumedAt !== null || input.clinic.hasConsumedEntitlement;
  if (!isTrialPlan(input.plan)) return { kind: "contract" };
  if (!trialConsumed) return { kind: "start_trial" };
  // トライアル対象プランで消費済み。cancelled(=新規契約が許可される既存Subscriptionが
  // ある)場合のみ「再契約」の文言にする。Subscriptionが無い(=一度も契約したことがない
  // のにトライアルだけ消費済み、という通常起こらない状態)場合は通常の契約文言にする。
  if (input.subscriptionStatus === "cancelled") return { kind: "recontract" };
  return { kind: "contract" };
}

// 2026-09-28追加(PO承認、P1-1/P1-2): ダッシュボード上部・診断結果ページのCTAは
// 特定の1プランに紐づかない(「プランを選ぶ」導線の入口であるため)。resolvePlanActionState
// はプラン単位の判定なので、ここでは医院単位の一段階上の状態を解決する。
export type DashboardTrialBannerState =
  | { kind: "billing_exempt" }
  | { kind: "manage_existing" } // 新規Checkoutを禁止する既存Subscriptionがあり、アップグレード対象でもない
  | { kind: "upgrade_available" } // 既存Subscriptionがあり、実装済みのアップグレード導線が使える
  | { kind: "continue_session" } // 有効なCheckout Sessionあり
  | { kind: "preparing" } // Session作成中
  | { kind: "no_diagnosis" } // まだ無料診断を完了していない
  | { kind: "trial_available" } // 無料診断済み・トライアル未消費・既存契約なし
  | { kind: "trial_consumed" }; // トライアル消費済み・既存契約なし(未契約)

export function resolveDashboardTrialBannerState(input: {
  isBillingExempt: boolean;
  subscriptionStatus: SubscriptionStatus | null;
  // 既存Subscriptionがある場合、実装済みのアップグレード導線(evaluateUpgrade)が
  // 何らかのプランへ使えるか(呼び出し元がplanUpgrade.tsの結果を渡す)。
  hasAnyUpgradeAvailable: boolean;
  hasDiagnosis: boolean;
  // 未ログインはこの関数の対象外(ダッシュボードは常に認証済み)なのでnullは扱わない。
  clinic: ClinicTrialCheckoutSnapshot;
}): DashboardTrialBannerState {
  if (input.isBillingExempt) return { kind: "billing_exempt" };

  const blocksNewCheckout =
    input.subscriptionStatus !== null &&
    hasExistingSubscription({ status: input.subscriptionStatus, billingExempt: false });

  if (blocksNewCheckout) {
    return input.hasAnyUpgradeAvailable ? { kind: "upgrade_available" } : { kind: "manage_existing" };
  }

  if (input.clinic.activeReservation) {
    return input.clinic.activeReservation.hasCheckoutSession
      ? { kind: "continue_session" }
      : { kind: "preparing" };
  }

  if (!input.hasDiagnosis) return { kind: "no_diagnosis" };

  const trialConsumed = input.clinic.trialConsumedAt !== null || input.clinic.hasConsumedEntitlement;
  return trialConsumed ? { kind: "trial_consumed" } : { kind: "trial_available" };
}

export function isVerifiedTrialingSubscriptionForConsumption(input: {
  subscription: StripeSubscriptionSnapshotForConsumption;
  expectedClinicId: string;
  expectedTrialEntitlementId: string;
  plan: string | null;
}): boolean {
  // 対象プランが無料トライアル対象(ライト/スタンダード)であること。
  if (!input.plan || !isTrialPlan(input.plan)) return false;
  // StripeのSubscriptionが実際に"trialing"であること(metadataの自己申告ではない)。
  if (input.subscription.status !== "trialing") return false;
  // トライアル期間の実データ(trial_start/trial_end)が存在すること。
  if (!input.subscription.trialStart && !input.subscription.trialEnd) return false;
  // Subscription自身のmetadataにあるclinicId・trialEntitlementIdが、Webhookが
  // 申告しているものと一致すること(Session側のmetadataだけを信用しない)。
  if (input.subscription.metadataClinicId !== input.expectedClinicId) return false;
  if (input.subscription.metadataTrialEntitlementId !== input.expectedTrialEntitlementId) {
    return false;
  }
  return true;
}
