import { describe, expect, it, vi } from "vitest";
import {
  callTimerexCalendarWithBookingUrl,
  extractTimerexWidgetUrlParams,
  stripTimerexWidgetDataUrl,
} from "@/components/timerex/timerexWidgetParams";

describe("timerexWidgetParams", () => {
  it("ds_refをクエリから取り出してurl_params引数を組み立てる", () => {
    expect(extractTimerexWidgetUrlParams("https://timerex.net/s/team/cal?ds_ref=clinic_1.sig")).toEqual({
      ds_ref: "clinic_1.sig",
    });
  });

  it("許可リストのutm_*もds_refと一緒にurl_paramsへ転記する", () => {
    expect(
      extractTimerexWidgetUrlParams(
        "https://timerex.net/s/team/cal?utm_source=x&utm_medium=email&ds_ref=clinic_1.sig"
      )
    ).toEqual({ utm_source: "x", utm_medium: "email", ds_ref: "clinic_1.sig" });
  });

  it("許可リストに無いクエリは用途未確認のため転記しない(機密値を誤送信しない)", () => {
    expect(
      extractTimerexWidgetUrlParams(
        "https://timerex.net/s/team/cal?ds_ref=clinic_1.sig&session_token=secret&email=user@example.com"
      )
    ).toEqual({ ds_ref: "clinic_1.sig" });
    expect(extractTimerexWidgetUrlParams("https://timerex.net/s/team/cal?session_token=secret")).toBeUndefined();
  });

  it("クエリが無ければundefinedを返す(不正なURLでも例外を投げない)", () => {
    expect(extractTimerexWidgetUrlParams("https://timerex.net/s/team/cal")).toBeUndefined();
    expect(extractTimerexWidgetUrlParams("not a url")).toBeUndefined();
  });

  it("#timerex_calendarのdata-url用にクエリを取り除く(許可外のパラメータを含め全て)", () => {
    expect(
      stripTimerexWidgetDataUrl("https://timerex.net/s/team/cal?utm_source=x&ds_ref=clinic_1.sig")
    ).toBe("https://timerex.net/s/team/cal");
    expect(stripTimerexWidgetDataUrl("not a url")).toBe("not a url");
  });

  it("TimeRexEmbedが実際に呼ぶ経路(callTimerexCalendarWithBookingUrl)がds_refをwindow.TimerexCalendarへ渡す", () => {
    const timerexCalendar = vi.fn();
    const called = callTimerexCalendarWithBookingUrl(
      timerexCalendar,
      "https://timerex.net/s/team/cal?ds_ref=clinic_1.sig"
    );
    expect(called).toBe(true);
    expect(timerexCalendar).toHaveBeenCalledTimes(1);
    expect(timerexCalendar).toHaveBeenCalledWith({ url_params: { ds_ref: "clinic_1.sig" } });
  });

  it("TimerexCalendarが未定義(スクリプト未読み込み)ならfalseを返し何も呼ばない", () => {
    expect(callTimerexCalendarWithBookingUrl(undefined, "https://timerex.net/s/team/cal?ds_ref=x")).toBe(
      false
    );
  });
});
