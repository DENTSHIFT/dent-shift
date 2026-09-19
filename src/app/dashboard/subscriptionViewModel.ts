import { PLAN_SUMMARIES, type PlanId } from "@/domain/billing/planCatalog";
import type { SubscriptionStatus } from "@/domain/billing/subscriptionStatus";

export type SubscriptionTone = "neutral" | "positive" | "info" | "warning" | "danger";

export interface DashboardSubscriptionRecord {
  plan: PlanId;
  status: SubscriptionStatus;
}

export interface DashboardSubscriptionViewModel {
  planName: string;
  statusLabel: string;
  description: string;
  tone: SubscriptionTone;
  actionLabel: string;
  actionHref: string;
}

const STATUS_PRESENTATION: Record<
  SubscriptionStatus,
  Pick<DashboardSubscriptionViewModel, "statusLabel" | "description" | "tone">
> = {
  trial: {
    statusLabel: "お試し期間中",
    description: "現在のお試し期間とプラン内容を確認できます。",
    tone: "info",
  },
  active: {
    statusLabel: "利用中",
    description: "契約中のプランが有効です。",
    tone: "positive",
  },
  past_due: {
    statusLabel: "お支払い確認中",
    description: "お支払いを確認できていません。確認後は自動的に利用中へ戻ります。",
    tone: "warning",
  },
  restricted: {
    statusLabel: "一部利用制限中",
    description: "お支払い状況により、一部機能が制限されています。",
    tone: "warning",
  },
  suspended: {
    statusLabel: "利用停止中",
    description: "現在このプランの機能は停止しています。",
    tone: "danger",
  },
  cancel_scheduled: {
    statusLabel: "解約予定",
    description: "解約予定として受け付けています。",
    tone: "warning",
  },
  cancelled: {
    statusLabel: "解約済み",
    description: "このプランの契約は終了しています。",
    tone: "neutral",
  },
};

export function buildSubscriptionViewModel(
  subscription: DashboardSubscriptionRecord | null,
  checkoutReady: boolean
): DashboardSubscriptionViewModel {
  if (!subscription) {
    return {
      planName: "プラン未選択",
      statusLabel: "未契約",
      description: checkoutReady
        ? "プランを比較してオンラインで契約できます。"
        : "料金とオンライン契約は現在準備中です。請求は発生していません。",
      tone: "neutral",
      actionLabel: "プランを比較する",
      actionHref: "/plans",
    };
  }

  const planName = PLAN_SUMMARIES.find((plan) => plan.id === subscription.plan)?.name;
  const status = STATUS_PRESENTATION[subscription.status];
  const canContinueOnboarding = ["trial", "active", "cancel_scheduled"].includes(
    subscription.status
  );
  return {
    planName: `${planName ?? subscription.plan}プラン`,
    ...status,
    actionLabel: canContinueOnboarding ? "初期設定を確認する" : "プラン内容を確認する",
    actionHref: canContinueOnboarding ? "/onboarding" : "/plans",
  };
}
