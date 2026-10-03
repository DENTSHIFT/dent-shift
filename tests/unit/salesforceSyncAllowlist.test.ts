import { describe, expect, it } from "vitest";
import { isClinicSyncAllowed, parseSalesforceSyncClinicAllowlist } from "@/server/config/salesforceSyncAllowlist";

describe("parseSalesforceSyncClinicAllowlist(段階的同期ガード)", () => {
  it("未設定・空・空白のみは全件停止(none)", () => {
    expect(parseSalesforceSyncClinicAllowlist({})).toEqual({ mode: "none", reason: "unset" });
    expect(parseSalesforceSyncClinicAllowlist({ SALESFORCE_SYNC_CLINIC_ALLOWLIST: "" })).toEqual({ mode: "none", reason: "empty" });
    expect(parseSalesforceSyncClinicAllowlist({ SALESFORCE_SYNC_CLINIC_ALLOWLIST: "   " })).toEqual({ mode: "none", reason: "empty" });
  });

  it("'*' は全医院許可", () => {
    expect(parseSalesforceSyncClinicAllowlist({ SALESFORCE_SYNC_CLINIC_ALLOWLIST: " * " })).toEqual({ mode: "all" });
  });

  it("医院IDの列挙は list(前後空白を除去)", () => {
    const parsed = parseSalesforceSyncClinicAllowlist({ SALESFORCE_SYNC_CLINIC_ALLOWLIST: "clinic_a, cmuf3tyj500019ui2sb7twdk2" });
    expect(parsed.mode).toBe("list");
    expect(isClinicSyncAllowed("clinic_a", parsed)).toBe(true);
    expect(isClinicSyncAllowed("cmuf3tyj500019ui2sb7twdk2", parsed)).toBe(true);
    expect(isClinicSyncAllowed("other", parsed)).toBe(false);
  });

  it("不正なトークン(空要素・記号・'*'との混在)が1つでもあれば全件停止(invalid)", () => {
    for (const value of ["clinic_a,", "clinic_a,,clinic_b", "clinic a", "clinic_a;clinic_b", "*,clinic_a", "clinic_a,*", "' OR 1=1"]) {
      expect(parseSalesforceSyncClinicAllowlist({ SALESFORCE_SYNC_CLINIC_ALLOWLIST: value })).toEqual({ mode: "none", reason: "invalid" });
    }
  });

  it("none では全医院が不許可", () => {
    expect(isClinicSyncAllowed("clinic_a", { mode: "none", reason: "unset" })).toBe(false);
  });
});
