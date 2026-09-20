export interface DiagnosisFormValues {
  clinicName: string;
  directorName: string;
  clinicUrl: string;
  contactEmail: string;
  contactPhone: string;
  gbpUrl: string;
  bookingUrl: string;
}

export interface AuthenticatedDiagnosisProfile {
  authenticated: true;
  clinicName: string;
  directorName: string | null;
  clinicUrl: string;
  contactEmail: string;
  contactPhone: string | null;
  gbpUrl: string | null;
  bookingUrl: string | null;
}

/**
 * 登録済みの医院名・公式URL・メールは必ず正本として反映する。
 * 任意URLは、取得中に利用者が入力を始めていた場合だけその入力を優先する。
 */
export function applyAuthenticatedDiagnosisProfile(
  current: DiagnosisFormValues,
  profile: AuthenticatedDiagnosisProfile
): DiagnosisFormValues {
  return {
    clinicName: profile.clinicName,
    directorName: profile.directorName?.trim() ? profile.directorName : current.directorName,
    clinicUrl: profile.clinicUrl,
    contactEmail: profile.contactEmail,
    contactPhone: profile.contactPhone?.trim() ? profile.contactPhone : current.contactPhone,
    gbpUrl: current.gbpUrl.trim() ? current.gbpUrl : profile.gbpUrl ?? "",
    bookingUrl: current.bookingUrl.trim() ? current.bookingUrl : profile.bookingUrl ?? "",
  };
}
