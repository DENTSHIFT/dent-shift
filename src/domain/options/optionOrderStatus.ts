/**
 * OptionOrderの状態機械(仕様書Ver1■6「オプション購入状態」)。
 * draft→preview_ready→payment_required/included→checkout_created→payment_pending
 * →paid→generation_queued→generating→generated→available→downloaded→completed
 * →remeasurement_pending→remeasured
 * 例外: payment_failed / generation_failed / refunded / cancelled / expired
 */
export const OPTION_ORDER_STATUSES = [
  "draft",
  "preview_ready",
  "payment_required",
  "included",
  "checkout_created",
  "payment_pending",
  "paid",
  "generation_queued",
  "generating",
  "generated",
  "available",
  "downloaded",
  "completed",
  "remeasurement_pending",
  "remeasured",
  "payment_failed",
  "generation_failed",
  "refunded",
  "cancelled",
  "expired",
] as const;

export type OptionOrderStatus = (typeof OPTION_ORDER_STATUSES)[number];

export function isOptionOrderStatus(value: string): value is OptionOrderStatus {
  return (OPTION_ORDER_STATUSES as readonly string[]).includes(value);
}

// 生成失敗からの再生成・決済失敗後の再Checkout等、"やり直し"は同じ注文行の状態を
// 進める(新しい注文を作らない)ことで二重課金・二重生成を防ぐ(仕様書■方針)。
const ALLOWED_TRANSITIONS: Record<OptionOrderStatus, readonly OptionOrderStatus[]> = {
  draft: ["preview_ready", "payment_required", "included", "checkout_created", "cancelled"],
  preview_ready: ["payment_required", "included", "checkout_created", "cancelled"],
  payment_required: ["checkout_created", "cancelled"],
  included: ["generation_queued", "cancelled"],
  checkout_created: ["payment_pending", "paid", "payment_failed", "cancelled", "expired"],
  payment_pending: ["paid", "payment_failed", "cancelled", "expired"],
  paid: ["generation_queued", "refunded"],
  generation_queued: ["generating"],
  generating: ["generated", "generation_failed"],
  generation_failed: ["generation_queued"],
  generated: ["available"],
  available: ["downloaded"],
  downloaded: ["downloaded", "completed"],
  completed: ["remeasurement_pending"],
  remeasurement_pending: ["remeasured"],
  remeasured: [],
  payment_failed: ["checkout_created", "cancelled"],
  refunded: [],
  cancelled: [],
  expired: ["checkout_created"],
};

export function canTransitionOptionOrderStatus(
  from: OptionOrderStatus,
  to: OptionOrderStatus
): boolean {
  if (from === to) return true;
  return ALLOWED_TRANSITIONS[from].includes(to);
}
