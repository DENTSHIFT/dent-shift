import "server-only";

/**
 * 2026-10-03追加(PO指示: 段階的同期ガード)。
 * Salesforce同期を「許可した医院」だけに限定する許可リスト。
 *
 * 環境変数 SALESFORCE_SYNC_CLINIC_ALLOWLIST:
 *   - 未設定 / 空 / 不正な値  → mode "none"(全件停止。fail-closed)
 *   - "clinicId1,clinicId2"  → mode "list"(列挙した医院IDのみ許可)
 * 医院IDは英数字・ハイフン・アンダースコアのみ(cuid形式)。1件でも不正なトークン
 * (空要素・記号・ワイルドカード "*" など)が含まれる場合は「不正」として全件停止にする
 * (部分的に許可してしまうより、送らない側に倒す)。**全医院を一括で許可する指定は存在しない**
 * (PO方針 2026-10-03: 承認したのは医院IDの明示列挙のみ)。
 *
 * 許可は医院単位で、その医院の既存イベント(保留中)・新規イベントの両方に及ぶ。
 * この判定は SALESFORCE_PROVIDER の判定とは独立しており、provider=disabled なら
 * 許可リストに関係なく同期しない。
 */
export type SalesforceSyncClinicAllowlist =
  | { mode: "none"; reason: "unset" | "empty" | "invalid" }
  | { mode: "list"; clinicIds: ReadonlySet<string> };

const CLINIC_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export function parseSalesforceSyncClinicAllowlist(
  env: Record<string, string | undefined>
): SalesforceSyncClinicAllowlist {
  const raw = env.SALESFORCE_SYNC_CLINIC_ALLOWLIST;
  if (raw === undefined) return { mode: "none", reason: "unset" };
  const trimmed = raw.trim();
  if (trimmed === "") return { mode: "none", reason: "empty" };
  const tokens = trimmed.split(",").map((t) => t.trim());
  if (tokens.some((t) => t === "" || t === "*" || !CLINIC_ID_PATTERN.test(t))) {
    return { mode: "none", reason: "invalid" };
  }
  return { mode: "list", clinicIds: new Set(tokens) };
}

export function resolveSalesforceSyncClinicAllowlistFromProcessEnv(): SalesforceSyncClinicAllowlist {
  return parseSalesforceSyncClinicAllowlist(process.env);
}

export function isClinicSyncAllowed(clinicId: string, allowlist: SalesforceSyncClinicAllowlist): boolean {
  if (allowlist.mode === "list") return allowlist.clinicIds.has(clinicId);
  return false;
}
