"use client";

import Script from "next/script";
import { useRef } from "react";

declare global {
  interface Window {
    TimerexCalendar?: () => void;
  }
}

const TIMEREX_EMBED_SCRIPT_ID = "timerex-embed-script";
const TIMEREX_EMBED_SCRIPT_SRC = "https://asset.timerex.net/js/embed.js";

/**
 * 診断結果ページの「診断結果について無料相談」CTA直下にのみ埋め込むTimeRexカレンダー
 * (2026-09-24)。LP・/visualは従来どおり外部URL(bookingUrl)への遷移CTAのみを維持し、
 * この埋め込みは診断後の結果ページに限定する。
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
    if (typeof window === "undefined" || typeof window.TimerexCalendar !== "function") return;
    try {
      window.TimerexCalendar();
      initializedRef.current = true;
    } catch {
      // 埋め込みウィジェットの初期化失敗時も、下のフォールバックリンクで予約は継続できる。
    }
  }

  return (
    <div style={{ marginTop: 16, width: "100%", minWidth: 0, boxSizing: "border-box" }}>
      <div
        id="timerex_calendar"
        data-url={bookingUrl}
        style={{ width: "100%", minWidth: 0, minHeight: 480, boxSizing: "border-box" }}
      />
      <Script
        id={TIMEREX_EMBED_SCRIPT_ID}
        src={TIMEREX_EMBED_SCRIPT_SRC}
        strategy="afterInteractive"
        onReady={initializeIfReady}
        onLoad={initializeIfReady}
      />
      <p style={{ margin: "10px 0 0", fontSize: 11, color: "#6B7280", overflowWrap: "anywhere" }}>
        カレンダーが表示されない場合は、
        <a href={bookingUrl} target="_blank" rel="noreferrer" style={{ color: "#2563EB" }}>
          こちらから直接ご予約ください
        </a>
        。
      </p>
    </div>
  );
}
