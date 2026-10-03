/**
 * TimeRex埋め込みウィジェット公式仕様(ウィジェットリファレンス「Integration by
 * parameters」)に基づき、bookingUrlのクエリ文字列に付いた全パラメータ(ds_ref、
 * および将来utm_*等が付与された場合も含む)を、window.TimerexCalendar({ url_params:
 * {...} }) へ渡す引数として組み立てる。
 *
 * data-url(#timerex_calendarのカレンダーURL)からはクエリを取り除く構成にするため
 * (stripTimerexWidgetDataUrl参照)、既存のクエリパラメータをここで落とさず全て
 * url_paramsへ転記する。ホスト型ページへの直接リンク(URLクエリへの付与のみ)では
 * WebhookのEvent.url_paramsに反映されないことを実機で確認済み(2026-10-03)。
 * ウィジェットのJavaScript API経由で明示的に渡した場合にWebhookへ反映される旨は
 * 公式ドキュメントに記載がある。
 *
 * 署名鍵(TIMEREX_BOOKING_REF_SECRET)はここでは一切扱わない。ds_refの値はサーバー側で
 * 生成済みの署名付き文字列であり、bookingUrlのクエリとして既にブラウザへ渡っている
 * 値をそのまま転記するだけ。
 */
export function extractTimerexWidgetUrlParams(bookingUrl: string): Record<string, string> | undefined {
  let parsed: URL;
  try {
    parsed = new URL(bookingUrl);
  } catch {
    return undefined;
  }
  if ([...parsed.searchParams.keys()].length === 0) return undefined;
  const params: Record<string, string> = {};
  for (const [key, value] of parsed.searchParams.entries()) {
    if (!(key in params)) params[key] = value;
  }
  return params;
}

/** ウィジェットの#timerex_calendarへ渡すdata-url(クエリなしのカレンダーURL)。 */
export function stripTimerexWidgetDataUrl(bookingUrl: string): string {
  try {
    const parsed = new URL(bookingUrl);
    parsed.search = "";
    return parsed.toString();
  } catch {
    return bookingUrl;
  }
}

/**
 * window.TimerexCalendar()の実呼び出し部分。TimeRexEmbed(Reactコンポーネント)から
 * 切り出すことで、DOM描画環境(jsdom等)を用意せずに「ds_refが実際に
 * window.TimerexCalendarへ渡るか」をユニットテストで検証できるようにする。
 * 戻り値はウィジェット関数を実際に呼べたかどうか(スクリプト未読み込み時はfalse)。
 */
export function callTimerexCalendarWithBookingUrl(
  timerexCalendar: ((args?: { url_params?: Record<string, string> }) => void) | undefined,
  bookingUrl: string
): boolean {
  if (typeof timerexCalendar !== "function") return false;
  const urlParams = extractTimerexWidgetUrlParams(bookingUrl);
  timerexCalendar(urlParams ? { url_params: urlParams } : undefined);
  return true;
}
