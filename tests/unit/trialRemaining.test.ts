import { describe, expect, it } from "vitest";
import { computeTrialRemaining, formatTrialEndDateInJapan } from "@/domain/billing/trialRemaining";

describe("computeTrialRemaining", () => {
  it("trialEndsAtがない場合はno_end_dateを返す(捏造しない)", () => {
    expect(computeTrialRemaining(null, new Date("2026-09-27T00:00:00Z"))).toEqual({
      kind: "no_end_date",
    });
  });

  it("終了日が未来なら、日本時間の暦日単位で残り日数を返す", () => {
    const result = computeTrialRemaining(
      new Date("2026-10-01T05:00:00Z"), // JST 10/1 14:00
      new Date("2026-09-27T00:00:00Z") // JST 9/27 9:00
    );
    expect(result).toEqual({ kind: "remaining", daysRemaining: 4, endDateLabel: "2026/10/1" });
  });

  it("終了日当日は時刻に関わらずends_todayを返す(境界不具合の防止)", () => {
    // 終了時刻: JST 10/2 12:00、判定時刻: JST 10/2 23:00(終了時刻より後だが同じ暦日)
    const result = computeTrialRemaining(
      new Date("2026-10-02T03:00:00Z"),
      new Date("2026-10-02T14:00:00Z")
    );
    expect(result.kind).toBe("ends_today");
  });

  it("終了日当日でも、判定時刻が終了時刻より前ならends_today(残り1日と誤表示しない)", () => {
    // 終了時刻: JST 10/2 12:00、判定時刻: JST 10/2 01:00(終了時刻より前、同じ暦日)
    const result = computeTrialRemaining(
      new Date("2026-10-02T03:00:00Z"),
      new Date("2026-10-01T16:00:00Z")
    );
    expect(result.kind).toBe("ends_today");
  });

  it("終了日の翌日以降はendedを返す", () => {
    const result = computeTrialRemaining(
      new Date("2026-10-01T05:00:00Z"),
      new Date("2026-10-03T00:00:00Z")
    );
    expect(result.kind).toBe("ended");
  });

  it("終了直前(残り1日)を正しく計算する", () => {
    const result = computeTrialRemaining(
      new Date("2026-09-28T05:00:00Z"), // JST 9/28
      new Date("2026-09-27T00:00:00Z") // JST 9/27
    );
    expect(result).toEqual({ kind: "remaining", daysRemaining: 1, endDateLabel: "2026/9/28" });
  });
});

describe("formatTrialEndDateInJapan", () => {
  it("日本時間の年/月/日で整形する", () => {
    expect(formatTrialEndDateInJapan(new Date("2026-10-01T15:00:00Z"))).toBe("2026/10/2");
  });
});
