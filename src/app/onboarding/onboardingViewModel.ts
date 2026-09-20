import { PLAN_SUMMARIES, type PlanId } from "@/domain/billing/planCatalog";
import type { SubscriptionStatus } from "@/domain/billing/subscriptionStatus";

export type OnboardingStepState = "complete" | "current" | "pending" | "attention";

export interface OnboardingStep {
  key: "account" | "contract" | "diagnosis";
  title: string;
  description: string;
  state: OnboardingStepState;
  stateLabel: string;
  actionLabel?: string;
  actionHref?: string;
}

export interface OnboardingViewModel {
  steps: OnboardingStep[];
  completedCount: number;
  totalCount: number;
  isComplete: boolean;
}

interface OnboardingSubscription {
  plan: PlanId;
  status: SubscriptionStatus;
}

const USABLE_STATUSES: readonly SubscriptionStatus[] = ["trial", "active", "cancel_scheduled"];

function buildContractStep(
  subscription: OnboardingSubscription | null,
  checkoutJustCompleted: boolean
): OnboardingStep {
  if (!subscription && checkoutJustCompleted) {
    return {
      key: "contract",
      title: "契約内容の反映",
      description: "お申し込みを受け付けました。契約情報の反映には数秒かかることがあります。",
      state: "pending",
      stateLabel: "反映を確認中",
      actionLabel: "更新して確認する",
      actionHref: "/onboarding?checkout=success",
    };
  }

  if (!subscription) {
    return {
      key: "contract",
      title: "利用プランを選ぶ",
      description: "料金と内容を比較し、医院に合うプランを選択します。",
      state: "current",
      stateLabel: "未完了",
      actionLabel: "プランを比較する",
      actionHref: "/plans",
    };
  }

  const planName = PLAN_SUMMARIES.find((plan) => plan.id === subscription.plan)?.name;
  if (USABLE_STATUSES.includes(subscription.status)) {
    return {
      key: "contract",
      title: "契約内容の確認",
      description: `${planName ?? subscription.plan}が反映されています。`,
      state: "complete",
      stateLabel: "完了",
      actionLabel: "プラン内容を見る",
      actionHref: "/plans",
    };
  }

  return {
    key: "contract",
    title: "お支払い状況の確認",
    description: "契約情報に確認が必要です。契約状況を確認してください。",
    state: "attention",
    stateLabel: "要確認",
    actionLabel: "契約状況を見る",
    actionHref: "/dashboard#subscription",
  };
}

export function buildOnboardingViewModel(input: {
  subscription: OnboardingSubscription | null;
  hasDiagnosis: boolean;
  latestDiagnosisId?: string;
  checkoutJustCompleted: boolean;
}): OnboardingViewModel {
  const contractStep = buildContractStep(input.subscription, input.checkoutJustCompleted);
  const diagnosisStep: OnboardingStep = input.hasDiagnosis
    ? {
        key: "diagnosis",
        title: "最初のAI集患診断",
        description: "現在地を確認するための診断結果が保存されています。",
        state: "complete",
        stateLabel: "完了",
        actionLabel: "診断結果を見る",
        actionHref: input.latestDiagnosisId
          ? `/diagnosis/result/${input.latestDiagnosisId}`
          : "/dashboard",
      }
    : {
        key: "diagnosis",
        title: "最初のAI集患診断",
        description: "6領域の現在地と、優先して改善する内容を確認します。",
        state: contractStep.state === "complete" ? "current" : "pending",
        stateLabel: contractStep.state === "complete" ? "次に進む" : "契約確認後",
        actionLabel: contractStep.state === "complete" ? "診断を始める" : undefined,
        actionHref: contractStep.state === "complete" ? "/diagnosis" : undefined,
      };

  const steps: OnboardingStep[] = [
    {
      key: "account",
      title: "医院アカウントの作成",
      description: "医院情報と担当者アカウントが登録されています。",
      state: "complete",
      stateLabel: "完了",
    },
    contractStep,
    diagnosisStep,
  ];
  const completedCount = steps.filter((step) => step.state === "complete").length;

  return {
    steps,
    completedCount,
    totalCount: steps.length,
    isComplete: completedCount === steps.length,
  };
}
