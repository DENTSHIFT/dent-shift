// SECURITY.md「運営側(管理・CS・分析・経理)」に対応する運営側ロール。
export const OPERATOR_ROLES = ["admin", "cs", "analyst", "finance"] as const;
export type OperatorRole = (typeof OPERATOR_ROLES)[number];

export function isOperatorRole(value: string): value is OperatorRole {
  return (OPERATOR_ROLES as readonly string[]).includes(value);
}
