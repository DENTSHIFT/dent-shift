/**
 * TimeRexへ転記してよいと用途を確認済みのクエリパラメータのみの許可リスト。
 * bookingUrlには将来どのようなクエリが付与されるか呼び出し側次第で予測できないため、
 * 全転記はせず、ここに列挙したキーだけを対象にする(機密値を誤ってTimeRexへ
 * 送らないため)。
 * - ds_ref: 医院紐付け用の署名付き参照(このアプリが発行、src/server/integration/
 *   bookingRef.tsのBOOKING_REF_PARAMと同じキー名)。このファイルはTimeRexEmbed(use
 *   client)から読み込まれるため、"server-only"が付いたbookingRef.tsを直接
 *   importできない。値そのものは署名鍵ではなく、既にbookingUrlのクエリとして
 *   ブラウザへ渡っているため、キー名をここに複製しても問題はない。
 * - utm_source/utm_medium/utm_campaign: TimeRex公式Webhookリファレンスの例にも
 *   登場する、計測用の一般的なUTMパラメータ
 */
const ALLOWED_TIMEREX_URL_PARAM_KEYS: readonly string[] = [
  "ds_ref",
  "utm_source",
  "utm_medium",
  "utm_campaign",
];

/**
 * TimeRex埋め込みウィジェット公式仕様(ウィジェットリファレンス「Integration by
 * parameters」)に基づき、bookingUrlのクエリ文字列のうち許可リストに載っている
 * パラメータだけを、window.TimerexCalendar({ url_params: {...} }) へ渡す引数として
 * 組み立てる。
 *
 * data-url(#timerex_calendarのカレンダーURL)からはクエリを取り除く構成にするため
 * (stripTimerexWidgetDataUrl参照)、許可リスト内のパラメータはここで落とさず
 * url_paramsへ転記する。それ以外のクエリ(将来何らかの理由で付与された場合)は
 * 用途未確認のためTimeRexへは送らない。ホスト型ページへの直接リンク(URLクエリへの
 * 付与のみ)ではWebhookのEvent.url_paramsに反映されないことを実機で確認済み
 * (2026-10-03)。ウィジェットのJavaScript API経由で明示的に渡した場合にWebhookへ
 * 反映される旨は公式ドキュメントに記載がある。
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
  const params: Record<string, string> = {};
  for (const key of ALLOWED_TIMEREX_URL_PARAM_KEYS) {
    const value = parsed.searchParams.get(key);
    if (value) params[key] = value;
  }
  return Object.keys(params).length > 0 ? params : undefined;
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
