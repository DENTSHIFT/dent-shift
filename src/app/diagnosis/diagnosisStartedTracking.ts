// 2026-09-24修正: useRefだけではページ再読み込み・戻る操作でリセットされ、
// 同一診断フロー中に「開始」イベントが重複してしまうため、sessionStorage
// (同一ブラウザタブに閉じたファーストパースト一時保存。他サイト・他タブへは
// 一切共有されない)に記録する。判定ロジック自体はDOM非依存の純粋関数として
// 切り出し、ブラウザを介さずにテストできるようにする。

// このタブでの1診断フロー中、開始イベントを送信済みであることを示す値。
// キー自体に個人情報は含まない(固定文字列の有無のみ)。
export const DIAGNOSIS_STARTED_SESSION_KEY = "ds_diagnosis_started_v1";
const FIRED_VALUE = "1";

/**
 * sessionStorageから読み取った生の値から、このタブで既に「開始」を
 * 記録済みかどうかを判定する。値が壊れている・想定外の場合は「未送信」扱いにする
 * (誤って計測を止めるより、まれに1回多く計測される方を許容する)。
 */
export function isDiagnosisStartedAlreadyFired(rawValue: string | null): boolean {
  return rawValue === FIRED_VALUE;
}

/** sessionStorageへ書き込む「送信済み」を表す値。 */
export function diagnosisStartedFiredMarker(): string {
  return FIRED_VALUE;
}
