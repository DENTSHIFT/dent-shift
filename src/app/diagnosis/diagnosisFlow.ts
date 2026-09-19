/**
 * 無料診断フォーム(src/app/diagnosis/page.tsx)の「入力→解析中→結果」遷移ゲートを、
 * Reactに依存しない純粋関数として切り出したもの(2026-09-06のユーザー指示への対応)。
 *
 * 背景: 実Mac上で「無料でAI集患診断する」を押すと解析中画面がほぼ表示されず結果画面へ
 * 即時遷移する、という報告があった。page.tsxを調査した結果、router.push(...)の呼び出しは
 * 1箇所のみで、「percent(表示用進捗) >= 100 かつ apiStatus === "success"」の両方を満たした
 * 場合にのみ実行される実装に既になっていた(即時遷移を引き起こす二重のrouter.push /
 * window.location / redirect / replace は見つからなかった)。とはいえユーザー指示のとおり、
 * 遷移条件を「最低表示時間の経過(analysisCompleted)」と「API成功+診断ID取得
 * (apiCompleted+diagnosisId)」という明確な独立フラグに分離し、遷移可否の判定をこの
 * 純粋関数1箇所へ集約することで、条件判定を型・テストの両方で保証できるようにする。
 */

export type DiagnosisFlowState = "form" | "analyzing" | "error";

export interface DiagnosisFlowSnapshot {
  flowState: DiagnosisFlowState;
  /** 最低表示時間(解析演出)が経過したか。UX表示専用のpercentアニメーションが100%に
   *  達した時に一度だけtrueになる(診断スコアや実際のAPI進捗とは無関係)。 */
  analysisCompleted: boolean;
  /** POST /api/diagnosisが成功し、diagnosisIdを取得できたか。 */
  apiCompleted: boolean;
  diagnosisId: string | null;
}

/**
 * 結果画面(/diagnosis/result/[id])へ遷移してよいかどうかを判定する、唯一の判定関数。
 * page.tsx側はこの関数がtrueを返した場合にのみ、たった1箇所のuseEffect内でrouter.push
 * を呼び出す(呼び出し箇所を分散させない)。
 *
 * 条件(ユーザー指示どおり): 「最低表示時間完了(analysisCompleted)」 AND
 * 「API成功+diagnosisId取得済み(apiCompleted && diagnosisId !== null)」の両方を満たし、
 * かつflowStateが"analyzing"であること(すでに"error"へ遷移していたら遷移しない)。
 */
export function shouldNavigateToResult(snapshot: DiagnosisFlowSnapshot): boolean {
  return (
    snapshot.flowState === "analyzing" &&
    snapshot.analysisCompleted &&
    snapshot.apiCompleted &&
    snapshot.diagnosisId !== null
  );
}
