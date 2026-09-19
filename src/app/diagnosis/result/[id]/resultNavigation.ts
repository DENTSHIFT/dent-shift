/**
 * 診断結果から医院ダッシュボードへ戻れるかを判定する。
 * ログイン中でも、別医院の結果URLを見ている場合は導線を表示しない。
 */
export function shouldShowDashboardReturnLink(
  contactClinicId: string | null | undefined,
  diagnosisClinicId: string
): boolean {
  return Boolean(contactClinicId && contactClinicId === diagnosisClinicId);
}
