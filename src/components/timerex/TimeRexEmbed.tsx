"use client";

import Script from "next/script";
import { useRef } from "react";
import styles from "./TimeRexEmbed.module.css";
import { callTimerexCalendarWithBookingUrl, stripTimerexWidgetDataUrl } from "./timerexWidgetParams";

declare global {
  interface Window {
    TimerexCalendar?: (args?: { url_params?: Record<string, string> }) => void;
  }
}

const TIMEREX_EMBED_SCRIPT_ID = "timerex-embed-script";
const TIMEREX_EMBED_SCRIPT_SRC = "https://asset.timerex.net/js/embed.js";

/**
 * 医院とTimeRex予約を対応付ける必要がある全ての導線(診断結果ページ、/consult経由の
 * ダッシュボード・初期設定ページ)で共通して使うTimeRex埋め込みカレンダー(2026-09-24、
 * 2026-10-03に共通化)。bookingUrlのクエリに付いたds_ref(withBookingRefで署名済み)を
 * ウィジェット公式のurl_params経由でWebhookまで届ける(ホスト型ページへの直接リンクでは
 * Webhookのevent.url_paramsに反映されないことを実機で確認済み、2026-10-03)。
 *
 * 下の直接リンク(フォールバック)はJS無効・読み込み失敗時のためのものであり、
 * url_paramsを運ばないため医院紐付けは保証されない。
 *
 * 二重初期化・画面遷移時のエラー対策:
 * - next/scriptの`onReady`は「スクリプトが既に他所で読み込み済みでも、このコンポーネントが
 *   マウントされるたびに」呼ばれる(`onLoad`は初回読み込み時の1回のみ)。診断結果ページ間を
 *   SPA遷移した場合でも、遷移先でTimerexCalendar()が確実に呼ばれるようonReadyを使う。
 * - initializedRefで、同一マウント内での多重呼び出し(onReady/onLoadが両方発火した場合等)
 *   を防ぐ。
 * - スクリプト自体はNext.jsがsrc単位で重複読み込みを防ぐため、複数の診断結果を
 *   行き来しても<script>タグが増殖しない。
 *
 * JavaScript無効・外部スクリプト読み込み失敗時のフォールバック:
 * - #timerex_calendarの直後に、常時表示のプレーンな<a>リンクを残す(JS不要で機能する)。
 */
export function TimeRexEmbed({ bookingUrl }: { bookingUrl: string }) {
  const initializedRef = useRef(false);

  function initializeIfReady() {
    if (initializedRef.current) return;
    if (typeof window === "undefined") return;
    try {
      if (callTimerexCalendarWithBookingUrl(window.TimerexCalendar, bookingUrl)) {
        initializedRef.current = true;
      }
    } catch {
      // 埋め込みウィジェットの初期化失敗時も、下のフォールバックリンクで予約は継続できる。
    }
  }

  return (
    <div style={{ marginTop: 16, width: "100%", minWidth: 0, boxSizing: "border-box" }}>
      {/* 2026-09-30修正(PO承認): TimeRexの埋め込みは550px未満のコンテナに
          対応できないため、狭い画面(599px以下)ではこの埋め込み自体を非表示にし、
          代わりに下のボタンで既存の予約ページを新規タブで開く。PC幅では
          従来どおり埋め込みカレンダーを表示する。 */}
      <div className={styles.desktopCalendar}>
        <div
          id="timerex_calendar"
          data-url={stripTimerexWidgetDataUrl(bookingUrl)}
          style={{ width: "100%", minWidth: 0, minHeight: 480, boxSizing: "border-box" }}
        />
        <p style={{ margin: "10px 0 0", fontSize: 11, color: "#6B7280", overflowWrap: "anywhere" }}>
          カレンダーが表示されない場合は、
          <a href={bookingUrl} target="_blank" rel="noreferrer" style={{ color: "#2563EB" }}>
            こちらから直接ご予約ください
          </a>
          。
        </p>
      </div>
      <a
        href={bookingUrl}
        target="_blank"
        rel="noreferrer"
        className={styles.mobileButton}
        style={{
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          background: "#1E3A8A",
          color: "#fff",
          padding: "12px 18px",
          borderRadius: 999,
          textDecoration: "none",
          fontWeight: 700,
          fontSize: 14,
          boxSizing: "border-box",
        }}
      >
        予約カレンダーを開く
      </a>
      <Script
        id={TIMEREX_EMBED_SCRIPT_ID}
        src={TIMEREX_EMBED_SCRIPT_SRC}
        strategy="afterInteractive"
        onReady={initializeIfReady}
        onLoad={initializeIfReady}
      />
    </div>
  );
}
