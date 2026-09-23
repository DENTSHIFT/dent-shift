import type { SubscriptionStatus } from "@/domain/billing/subscriptionStatus";

export interface FeatureAccessNotice {
  heading: string;
  body: string;
  ctaLabel: string;
  ctaHref: string;
  // "post"はStripe Customer Portal等、フォーム送信(action=ctaHref, method="post")で
  // 遷移する必要があるCTA。"get"は通常のLinkでよい。
  ctaMethod: "get" | "post";
}

/**
 * 契約状態によりダッシュボードの主要機能(診断・レポート等)へのアクセスを制限する際の
 * 案内文。技術用語(ステータス名等)を出さず、一般利用者に分かりやすい表現に留める
 * (2026-09-24のユーザー指示)。past_due/restricted/suspendedはお支払い確認へ、
 * cancelledは再契約導線へ誘導する。
 */
const FEATURE_ACCESS_NOTICES: Partial<Record<SubscriptionStatus, FeatureAccessNotice>> = {
  past_due: {
    heading: "お支払い情報をご確認ください",
    body: "お支払いの確認が取れていないため、現在この機能はご利用いただけません。お支払い情報をご確認のうえ、解決しない場合はお問い合わせください。",
    ctaLabel: "お支払い情報を確認する",
    ctaHref: "/api/billing/portal",
    ctaMethod: "post",
  },
  restricted: {
    heading: "現在この機能はご利用いただけません",
    body: "現在この機能はご利用いただけません。お支払い情報をご確認いただくか、お問い合わせください。",
    ctaLabel: "お支払い情報を確認する",
    ctaHref: "/api/billing/portal",
    ctaMethod: "post",
  },
  suspended: {
    heading: "現在この機能はご利用いただけません",
    body: "現在この機能はご利用いただけません。お支払い情報をご確認いただくか、お問い合わせください。",
    ctaLabel: "お支払い情報を確認する",
    ctaHref: "/api/billing/portal",
    ctaMethod: "post",
  },
  cancelled: {
    heading: "ご契約が終了しています",
    body: "ご契約が終了しているため、現在この機能はご利用いただけません。引き続きご利用になる場合は、再契約をお願いします。",
    ctaLabel: "再契約する",
    ctaHref: "/plans",
    ctaMethod: "get",
  },
};

export function resolveFeatureAccessNotice(status: SubscriptionStatus): FeatureAccessNotice | null {
  return FEATURE_ACCESS_NOTICES[status] ?? null;
}
