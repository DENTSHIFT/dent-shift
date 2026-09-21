/**
 * 診断結果ページの閲覧可否を判定する。
 *
 * 無料診断結果は「URLを知っていれば見られる」ことが製品設計上意図的な公開範囲
 * (diagnosisRepository.tsのコメント・SECURITY.md参照)。ただし、その医院が
 * 既に会員登録(Contactを持つ)している場合は「契約後データ」とみなし、
 * 該当clinicの認証済みユーザー以外には見せない(2026-09-21のユーザー指示:
 * 「公開範囲と契約後データを明確に分離する」)。
 *
 * まだ誰も会員登録していない医院の診断(clinicHasAccount=false)は、
 * 従来どおり匿名でも閲覧できる。
 */
export function isDiagnosisResultAccessible(input: {
  clinicHasAccount: boolean;
  contactClinicId: string | null | undefined;
  diagnosisClinicId: string;
}): boolean {
  if (!input.clinicHasAccount) return true;
  return Boolean(input.contactClinicId && input.contactClinicId === input.diagnosisClinicId);
}
