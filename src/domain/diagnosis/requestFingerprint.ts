import { createHash } from "node:crypto";

/**
 * 2026-09-29追加(PO指摘、冪等性キーの入力一致検証P0): 同じclientRequestIdで
 * 異なる入力(医院名・URL等)が送られていないかを検証するための、リクエスト本文の
 * フィンガープリント。診断結果そのもの(AI観測・スコア)ではなく、「何を診断対象と
 * したか」を決める入力フィールドだけを対象にする(UTM等の付随情報は対象外。
 * 同じ診断対象への再送であれば許容してよい変動要素のため)。
 */
export interface DiagnosisRequestFingerprintInput {
  clinicName?: unknown;
  directorName?: unknown;
  clinicUrl?: unknown;
  contactEmail?: unknown;
  contactPhone?: unknown;
  gbpUrl?: unknown;
  bookingUrl?: unknown;
}

export function computeDiagnosisRequestFingerprint(input: DiagnosisRequestFingerprintInput): string {
  const normalized = JSON.stringify({
    clinicName: String(input.clinicName ?? ""),
    directorName: String(input.directorName ?? ""),
    clinicUrl: String(input.clinicUrl ?? ""),
    contactEmail: String(input.contactEmail ?? ""),
    contactPhone: String(input.contactPhone ?? ""),
    gbpUrl: String(input.gbpUrl ?? ""),
    bookingUrl: String(input.bookingUrl ?? ""),
  });
  return createHash("sha256").update(normalized).digest("hex");
}
