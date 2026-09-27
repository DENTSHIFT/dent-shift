import { PLAN_SUMMARIES, type PlanId } from "@/domain/billing/planCatalog";
import type { SubscriptionStatus } from "@/domain/billing/subscriptionStatus";
import { computeTrialRemaining } from "@/domain/billing/trialRemaining";

export type SubscriptionTone = "neutral" | "positive" | "info" | "warning" | "danger";

export interface DashboardSubscriptionRecord {
  plan: PlanId;
  status: SubscriptionStatus;
  // 永久無料の特別アカウント(既定false/未指定)。trueの場合、契約状況カードの
  // 表示を「永久無料プラン」として明示する(billingRepository.createSubscriptionRecord参照)。
  billingExempt?: boolean;
  // 2026-09-27追加(PO承認、第1段階): トライアル終了日(Stripeのtrial_endを
  // customer.subscription.*Webhookで同期した実データ、billingRepository参照)。
  // 固定値・ダミー値ではなく、常にこの値から残り日数を計算する。
  trialEndsAt?: Date | null;
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
    description: "7日間無料トライアル中です。期間中の請求は発生しません。",
    tone: "info",
  },
  active: {
    statusLabel: "利用中",
    description: "ご契約のプランをご利用中です。",
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
  checkoutReady: boolean,
  now: Date = new Date()
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
  const isLifetimeFree = subscription.billingExempt === true;
  const isTrialing = subscription.status === "trial" && !isLifetimeFree;

  // 2026-09-27追加(PO承認、第1段階): トライアル中は固定文言ではなく、実データの
  // trialEndsAtから計算した終了日・残り日数を表示する。billingExempt(永久無料)は
  // trialEndsAtを持たない運用のため対象外。
  const trialDescription = isTrialing
    ? (() => {
        const remaining = computeTrialRemaining(subscription.trialEndsAt ?? null, now);
        if (remaining.kind === "no_end_date") {
          return "7日間無料トライアル中です。期間中の請求は発生しません。";
        }
        if (remaining.kind === "ended") {
          return `無料トライアルは${remaining.endDateLabel}に終了しました。ご契約状況の確認をお願いします。`;
        }
        if (remaining.kind === "ends_today") {
          return `無料トライアルは本日(${remaining.endDateLabel})終了します。キャンセルしない場合、選択中のプランの料金が発生します。`;
        }
        return `無料トライアル中です。あと${remaining.daysRemaining}日(${remaining.endDateLabel}終了予定)。キャンセルしない場合、終了後に選択中のプランの料金が発生します。`;
      })()
    : status.description;

  return {
    planName: planName ?? subscription.plan,
    ...status,
    description: trialDescription,
    ...(isLifetimeFree
      ? {
          statusLabel: "永久無料",
          description: "永久無料の特別プランとしてご利用いただけます。お支払いは発生しません。",
        }
      : {}),
    actionLabel: isTrialing ? "プランを確認する" : canContinueOnboarding ? "初期設定を確認する" : "プラン内容を確認する",
    actionHref: isTrialing ? "/plans" : canContinueOnboarding ? "/onboarding" : "/plans",
  };
}
