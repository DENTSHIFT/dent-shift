import "server-only";

/**
 * 2026-09-29追加(PO承認、再診断ループの連続実行対策P0): 診断API(/api/diagnosis)の
 * 外部AI呼び出し前レート制限の設定値。PO指示「IP制限は同じ院内回線を共有する利用者にも
 * 影響するため、設定で調整可能にしてください」に対応し、暫定値(IP: 10分3回、
 * Clinic/Contact: 1時間5回)を環境変数で上書きできるようにする。未設定時は暫定値を使う。
 *
 * これはプラン別の無料/有料利用回数制限とは別物で、値を変更してもプラン契約の
 * 利用条件には一切影響しない(billing/subscriptionのロジックからは参照されない)。
 */
export interface DiagnosisRateLimitConfig {
  ip: { windowMs: number; maxRequests: number };
  clinic: { windowMs: number; maxRequests: number };
  contact: { windowMs: number; maxRequests: number };
}

const DEFAULT_IP_WINDOW_MS = 10 * 60 * 1000; // 10分
const DEFAULT_IP_MAX_REQUESTS = 3;
const DEFAULT_ACCOUNT_WINDOW_MS = 60 * 60 * 1000; // 1時間
const DEFAULT_ACCOUNT_MAX_REQUESTS = 5;

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export function resolveDiagnosisRateLimitConfig(
  env: Record<string, string | undefined>
): DiagnosisRateLimitConfig {
  return {
    ip: {
      windowMs: parsePositiveInt(env.DIAGNOSIS_RATE_LIMIT_IP_WINDOW_MS, DEFAULT_IP_WINDOW_MS),
      maxRequests: parsePositiveInt(
        env.DIAGNOSIS_RATE_LIMIT_IP_MAX_REQUESTS,
        DEFAULT_IP_MAX_REQUESTS
      ),
    },
    clinic: {
      windowMs: parsePositiveInt(
        env.DIAGNOSIS_RATE_LIMIT_CLINIC_WINDOW_MS,
        DEFAULT_ACCOUNT_WINDOW_MS
      ),
      maxRequests: parsePositiveInt(
        env.DIAGNOSIS_RATE_LIMIT_CLINIC_MAX_REQUESTS,
        DEFAULT_ACCOUNT_MAX_REQUESTS
      ),
    },
    contact: {
      windowMs: parsePositiveInt(
        env.DIAGNOSIS_RATE_LIMIT_CONTACT_WINDOW_MS,
        DEFAULT_ACCOUNT_WINDOW_MS
      ),
      maxRequests: parsePositiveInt(
        env.DIAGNOSIS_RATE_LIMIT_CONTACT_MAX_REQUESTS,
        DEFAULT_ACCOUNT_MAX_REQUESTS
      ),
    },
  };
}

export function resolveDiagnosisRateLimitConfigFromProcessEnv(): DiagnosisRateLimitConfig {
  return resolveDiagnosisRateLimitConfig(process.env);
}
