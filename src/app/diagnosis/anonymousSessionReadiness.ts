/**
 * 2026-09-29追加(PO指摘、匿名Cookie初回リクエスト対策P0、2回目)。
 *
 * 匿名利用者の冪等性principalKeyに使うセッションcookie(ds_anon_diag)を、
 * 診断フォーム送信(POST /api/diagnosis)より前に確立しておくための、DOM/Reactに
 * 依存しない純粋なゲート関数。ページ表示時点の先行呼び出しと、実際の送信直前の
 * 呼び出しの両方が同じ関数を通ることで、「取得中にちょうど送信した」場合も
 * 同じ1つのin-flight promiseを待つだけで済む。
 *
 * - 成功したPromiseはメモ化せず都度作り直す設計ではない: 一度成功したら以後の
 *   呼び出しは同じ解決済みPromiseをそのまま返す(再度GETを送らない)。
 * - 失敗した場合はin-flight状態をクリアし、次回呼び出しで新しいGETを再試行する
 *   (診断フォームの「もう一度診断する」からの再送信で自然に再試行される)。
 */
export function createAnonymousSessionReadinessGate(
  fetchImpl: typeof fetch = fetch
): () => Promise<void> {
  let inFlight: Promise<void> | null = null;

  return function ensureAnonymousDiagnosisSessionReady(): Promise<void> {
    if (!inFlight) {
      inFlight = fetchImpl("/api/diagnosis/session", {
        method: "GET",
        credentials: "same-origin",
      })
        .then((res) => {
          if (!res.ok) {
            throw new Error(`anonymous diagnosis session warmup failed with status ${res.status}`);
          }
        })
        .catch((error) => {
          inFlight = null;
          throw error;
        });
    }
    return inFlight;
  };
}
