// 2026-09-27追加(PO承認、第1段階): ダッシュボードの契約状況カードに、
// Subscription.trialEndsAt(実データ)から計算した残り日数・終了日を表示するための
// 純粋関数。固定値・ダミー値は一切使わず、常にDBの値とサーバー時刻から算出する。
//
// 日付境界の扱い: 日本時間(Asia/Tokyo)の「日付」単位で比較する。トライアル終了時刻
// (trialEndsAt)当日は「本日終了」、終了日を過ぎたら「終了しました」とし、
// 期限切れなのに「残り1日」のように見えることがないようにする。

export type TrialRemaining =
  | { kind: "no_end_date" }
  | { kind: "ended"; endDateLabel: string }
  | { kind: "ends_today"; endDateLabel: string }
  | { kind: "remaining"; daysRemaining: number; endDateLabel: string };

const JAPAN_TIME_ZONE = "Asia/Tokyo";

function toJapanDateOnlyKey(date: Date): string {
  // "YYYY-MM-DD"(Asia/Tokyo基準の暦日)を返す。時刻情報は比較に含めない。
  return new Intl.DateTimeFormat("en-CA", { timeZone: JAPAN_TIME_ZONE }).format(date);
}

function toJapanDateOnly(date: Date): Date {
  // 上記の暦日キーをUTC 0時のDateへ変換する。これにより、暦日どうしの引き算が
  // 時刻・タイムゾーンの影響を受けずに正確な日数差になる。
  return new Date(`${toJapanDateOnlyKey(date)}T00:00:00Z`);
}

export function formatTrialEndDateInJapan(value: Date): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: JAPAN_TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).format(value);
}

export function computeTrialRemaining(trialEndsAt: Date | null, now: Date): TrialRemaining {
  if (!trialEndsAt) return { kind: "no_end_date" };

  const endDateLabel = formatTrialEndDateInJapan(trialEndsAt);
  const endDay = toJapanDateOnly(trialEndsAt).getTime();
  const today = toJapanDateOnly(now).getTime();
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const dayDiff = Math.round((endDay - today) / MS_PER_DAY);

  if (dayDiff < 0) return { kind: "ended", endDateLabel };
  if (dayDiff === 0) return { kind: "ends_today", endDateLabel };
  return { kind: "remaining", daysRemaining: dayDiff, endDateLabel };
}
