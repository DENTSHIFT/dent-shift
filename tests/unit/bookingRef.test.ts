import { describe, expect, it } from "vitest";
import { createBookingRef, verifyBookingRef, withBookingRef } from "@/server/integration/bookingRef";

const ENV = { TIMEREX_BOOKING_REF_SECRET: "test-secret" };

describe("bookingRef", () => {
  it("署名付き参照を検証して医院IDを返し、改ざん・別の鍵は拒否する", () => {
    const ref = createBookingRef("clinic_1", ENV)!;
    expect(verifyBookingRef(ref, ENV)).toBe("clinic_1");
    expect(verifyBookingRef(ref.replace("clinic_1", "clinic_2"), ENV)).toBeNull();
    expect(verifyBookingRef(ref, { TIMEREX_BOOKING_REF_SECRET: "other" })).toBeNull();
    expect(verifyBookingRef("clinic_1", ENV)).toBeNull();
  });

  it("予約URLへds_refを付け、既存のクエリは保持する。鍵が無ければ元のURLのまま", () => {
    const url = new URL(withBookingRef("https://timerex.net/s/team/cal?utm_source=x", "clinic_1", ENV));
    expect(url.searchParams.get("utm_source")).toBe("x");
    expect(verifyBookingRef(url.searchParams.get("ds_ref")!, ENV)).toBe("clinic_1");
    expect(withBookingRef("https://timerex.net/s/team/cal", "clinic_1", {})).toBe("https://timerex.net/s/team/cal");
  });
});
