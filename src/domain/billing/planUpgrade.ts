import type { PlanId } from "./planCatalog";
import { PLAN_SUMMARIES } from "./planCatalog";
import type { SubscriptionStatus } from "./subscriptionStatus";

const PLAN_RANK: Readonly<Record<PlanId, number>> = { light: 1, standard: 2, premium: 3 };

export function isUpgrade(from: PlanId, to: PlanId): boolean {
  return PLAN_RANK[to] > PLAN_RANK[from];
}

export function upgradeTargetsFor(plan: PlanId): PlanId[] {
  return (Object.keys(PLAN_RANK) as PlanId[]).filter((target) => isUpgrade(plan, target));
}

// アップグレードできるのはトライアル中(trial)か有効(active)な通常契約のみ。
// 支払い遅延・停止・解約後の契約や、永久無料(billingExempt)・招待経由の契約は対象外。
const UPGRADABLE_STATUSES: readonly SubscriptionStatus[] = ["trial", "active"];

export type UpgradeDecision =
  | { ok: true; proration: "none" | "always_invoice" }
  | { ok: false; reason: "not_upgradable_status" | "exempt" | "not_an_upgrade" };

export function evaluateUpgrade(input: {
  currentPlan: PlanId;
  status: SubscriptionStatus;
  billingExempt: boolean;
  invited: boolean;
  targetPlan: PlanId;
}): UpgradeDecision {
  if (input.billingExempt || input.invited) return { ok: false, reason: "exempt" };
  if (!UPGRADABLE_STATUSES.includes(input.status)) return { ok: false, reason: "not_upgradable_status" };
  if (!isUpgrade(input.currentPlan, input.targetPlan)) return { ok: false, reason: "not_an_upgrade" };
  // トライアル中は請求が発生していないため按分せず、trial_endもそのまま維持する。
  // 有効契約は差額を即時請求する。
  return { ok: true, proration: input.status === "trial" ? "none" : "always_invoice" };
}

export interface UpgradeNotice {
  heading: string;
  body: string;
  ctaLabel: string;
  ctaHref: string;
}

function planName(plan: PlanId): string {
  return PLAN_SUMMARIES.find((p) => p.id === plan)?.name ?? plan;
}

/**
 * 機能単位の共通アップグレード案内。現在のプランが必要プランに満たない場合のみ返す。
 * 呼び出し側は、実装済みの機能に対してのみ使うこと(未実装機能に「使える」と誤表示しない)。
 */
export function buildUpgradeNotice(input: {
  currentPlan: PlanId | null;
  requiredPlan: PlanId;
  featureLabel: string;
  gain: string;
}): UpgradeNotice | null {
  const current = input.currentPlan ?? "light";
  if (!isUpgrade(current, input.requiredPlan)) return null;
  const required = planName(input.requiredPlan);
  return {
    heading: `この機能を利用するには${required}以上へのアップグレードが必要です`,
    body: `${input.featureLabel}: ${input.gain}`,
    ctaLabel: `${required}にアップグレード`,
    ctaHref: "/plans",
  };
}
