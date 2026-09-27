import { isValidClinicContactPhone } from "./contactPhone";

export const CLINIC_PROFILE_FIELDS = [
  "name",
  "directorName",
  "url",
  "gbpUrl",
  "bookingUrl",
  "contactPhone",
] as const;
export type ClinicProfileField = (typeof CLINIC_PROFILE_FIELDS)[number];

export interface ClinicProfileValues {
  name: string;
  directorName: string | null;
  url: string;
  gbpUrl: string | null;
  bookingUrl: string | null;
  contactPhone: string | null;
}

export type ClinicProfileErrors = Partial<Record<ClinicProfileField, string>>;

export type ClinicProfileValidation =
  | { ok: true; value: ClinicProfileValues }
  | { ok: false; errors: ClinicProfileErrors };

const LIMITS = { name: 100, directorName: 50, url: 2048, phone: 20 } as const;

function asTrimmed(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

// http(s)以外(javascript:等)は保存させない。
function checkUrl(value: string, label: string): string | null {
  if (value.length > LIMITS.url) return `${label}は${LIMITS.url}文字以内で入力してください`;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return `${label}は https:// から始まるURLの形式で入力してください`;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return `${label}は https:// から始まるURLの形式で入力してください`;
  }
  return null;
}

export function validateClinicProfileInput(raw: unknown): ClinicProfileValidation {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const errors: ClinicProfileErrors = {};

  const name = asTrimmed(input.name);
  if (!name) errors.name = "医院名を入力してください";
  else if (name.length > LIMITS.name) errors.name = `医院名は${LIMITS.name}文字以内で入力してください`;

  const directorName = asTrimmed(input.directorName);
  if (directorName.length > LIMITS.directorName) {
    errors.directorName = `院長名は${LIMITS.directorName}文字以内で入力してください`;
  }

  const url = asTrimmed(input.url);
  if (!url) errors.url = "WebサイトURLを入力してください";
  else {
    const urlError = checkUrl(url, "WebサイトURL");
    if (urlError) errors.url = urlError;
  }

  const gbpUrl = asTrimmed(input.gbpUrl);
  if (gbpUrl) {
    const gbpError = checkUrl(gbpUrl, "GoogleビジネスプロフィールURL");
    if (gbpError) errors.gbpUrl = gbpError;
  }

  const bookingUrl = asTrimmed(input.bookingUrl);
  if (bookingUrl) {
    const bookingError = checkUrl(bookingUrl, "予約URL");
    if (bookingError) errors.bookingUrl = bookingError;
  }

  const contactPhone = asTrimmed(input.contactPhone);
  if (contactPhone) {
    if (contactPhone.length > LIMITS.phone || !isValidClinicContactPhone(contactPhone)) {
      errors.contactPhone = "電話番号は0から始まる10〜11桁の形式で入力してください(例: 03-1234-5678)";
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      name,
      directorName: directorName || null,
      url,
      gbpUrl: gbpUrl || null,
      bookingUrl: bookingUrl || null,
      contactPhone: contactPhone || null,
    },
  };
}

export function changedClinicProfileFields(
  before: Record<ClinicProfileField, string | null>,
  after: ClinicProfileValues
): ClinicProfileField[] {
  return CLINIC_PROFILE_FIELDS.filter((field) => (before[field] ?? null) !== (after[field] ?? null));
}
