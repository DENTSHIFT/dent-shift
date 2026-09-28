/**
 * 2026-09-29追加(PO指示): サーバーコンポーネントのデータ取得中、画面に何の
 * 視覚的フィードバックも出ない(体感で反応が遅く感じる)ページ遷移向けの、
 * 共通の軽量ローディング表示。Next.js App Routerの`loading.tsx`規約から
 * 自動的に描画される(対象ルートのサーバーレンダリングが完了すると自動的に
 * 差し替わり/消える。戻る操作時や描画完了後にこの表示が残り続けることはない)。
 *
 * PO指示により「大規模なスケルトンUIやデザイン調整は行わない」ため、
 * 既存の`.gauge`等に合わせた最小限のスピナー+テキストのみとする。
 */
export function RouteLoadingIndicator() {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        minHeight: "40vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        color: "#6B7280",
        fontSize: 13,
      }}
    >
      <div
        aria-hidden="true"
        style={{
          width: 28,
          height: 28,
          borderRadius: "50%",
          border: "3px solid #E5E9F0",
          borderTopColor: "#2563EB",
          animation: "ds-route-loading-spin 0.8s linear infinite",
        }}
      />
      <span>読み込んでいます…</span>
      <style>{`
        @keyframes ds-route-loading-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
