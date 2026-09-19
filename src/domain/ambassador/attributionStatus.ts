export const ATTRIBUTION_STATUSES = ["pending", "confirmed"] as const;
export type AttributionStatus = (typeof ATTRIBUTION_STATUSES)[number];

export function isAttributionStatus(value: string): value is AttributionStatus {
  return (ATTRIBUTION_STATUSES as readonly string[]).includes(value);
}

/**
 * 紹介経由の医院登録(pending)は、有料契約+初回入金確定時点でのみconfirmedへ進む
 * (IMPLEMENTATION_PLAN.md Step8、ユーザー指示)。一度confirmedになった成果は取り消さない。
 */
export function canTransitionAttribution(
  from: AttributionStatus,
  to: AttributionStatus
): boolean {
  if (from === to) return true;
  return from === "pending" && to === "confirmed";
}
