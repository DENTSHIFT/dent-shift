import { normalizeUrl } from "@/domain/ai-measurement/urlNormalization";

export type ClinicDuplicateMatchType = "exact_url" | "same_domain" | "exact_name";

export interface ClinicDuplicateCandidate {
  clinicId: string;
  matchType: ClinicDuplicateMatchType;
}

export interface ExistingClinicIdentity {
  id: string;
  name: string;
  url: string;
}

function normalizeClinicName(name: string): string {
  return name.normalize("NFKC").trim().toLocaleLowerCase("ja-JP").replace(/\s+/g, "");
}

/**
 * 完全URL一致を最優先し、次に同一host、最後に医院名一致を候補として返す。
 * ここでは候補を検出するだけで、既存Clinicへの自動統合や権限付与は絶対に行わない。
 */
export function detectClinicDuplicateCandidate(
  input: { clinicName: string; clinicUrl: string },
  existingClinics: ExistingClinicIdentity[]
): ClinicDuplicateCandidate | null {
  const inputUrl = normalizeUrl(input.clinicUrl);
  if (!inputUrl) return null;

  const withNormalizedUrl = existingClinics
    .map((clinic) => ({ clinic, normalizedUrl: normalizeUrl(clinic.url) }))
    .filter(
      (entry): entry is { clinic: ExistingClinicIdentity; normalizedUrl: NonNullable<ReturnType<typeof normalizeUrl>> } =>
        entry.normalizedUrl !== null
    );

  const exactUrl = withNormalizedUrl.find(
    ({ normalizedUrl }) =>
      normalizedUrl.host === inputUrl.host && normalizedUrl.path === inputUrl.path
  );
  if (exactUrl) {
    return { clinicId: exactUrl.clinic.id, matchType: "exact_url" };
  }

  const sameDomain = withNormalizedUrl.find(
    ({ normalizedUrl }) => normalizedUrl.host === inputUrl.host
  );
  if (sameDomain) {
    return { clinicId: sameDomain.clinic.id, matchType: "same_domain" };
  }

  const normalizedName = normalizeClinicName(input.clinicName);
  if (!normalizedName) return null;
  const exactName = existingClinics.find(
    (clinic) => normalizeClinicName(clinic.name) === normalizedName
  );

  return exactName ? { clinicId: exactName.id, matchType: "exact_name" } : null;
}

export function duplicateCandidateMessage(matchType: ClinicDuplicateMatchType): string {
  if (matchType === "exact_name") {
    return "同じ医院名のデータがすでにあります。既存アカウントをお持ちの場合はログインしてください。別の医院であれば、確認後に診断を続けられます。";
  }
  return "同じ公式サイトの医院データがすでにあります。既存アカウントをお持ちの場合はログインしてください。別データとして扱う場合は、確認後に診断を続けられます。";
}
