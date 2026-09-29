import { describe, expect, it } from "vitest";
import { resolveDiagnosisRateLimitConfig } from "@/server/config/diagnosisRateLimitConfig";

describe("resolveDiagnosisRateLimitConfig", () => {
  it("未設定時は暫定値(IP:10分3回、Clinic/Contact:1時間5回)を使う", () => {
    const config = resolveDiagnosisRateLimitConfig({});
    expect(config).toEqual({
      ip: { windowMs: 10 * 60 * 1000, maxRequests: 3 },
      clinic: { windowMs: 60 * 60 * 1000, maxRequests: 5 },
      contact: { windowMs: 60 * 60 * 1000, maxRequests: 5 },
    });
  });

  it("環境変数でIPの窓・上限を調整できる(同じ院内回線を共有する利用者への配慮)", () => {
    const config = resolveDiagnosisRateLimitConfig({
      DIAGNOSIS_RATE_LIMIT_IP_WINDOW_MS: "600000",
      DIAGNOSIS_RATE_LIMIT_IP_MAX_REQUESTS: "10",
    });
    expect(config.ip).toEqual({ windowMs: 600000, maxRequests: 10 });
  });

  it("不正な値(0以下・非数値)は暫定値へフォールバックする", () => {
    const config = resolveDiagnosisRateLimitConfig({
      DIAGNOSIS_RATE_LIMIT_IP_MAX_REQUESTS: "0",
      DIAGNOSIS_RATE_LIMIT_CLINIC_WINDOW_MS: "not-a-number",
    });
    expect(config.ip.maxRequests).toBe(3);
    expect(config.clinic.windowMs).toBe(60 * 60 * 1000);
  });
});
