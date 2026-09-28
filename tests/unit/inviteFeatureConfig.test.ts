import { describe, expect, it } from "vitest";
import { resolveInviteFeatureConfig } from "@/server/config/inviteFeatureConfig";

describe("resolveInviteFeatureConfig", () => {
  it("INVITE_FEATURE_ENABLED未設定ならdisabled(false)", () => {
    expect(resolveInviteFeatureConfig({ env: {} })).toEqual({ enabled: false });
  });

  it("INVITE_FEATURE_ENABLEDが'true'以外ならdisabled(false)", () => {
    expect(resolveInviteFeatureConfig({ env: { INVITE_FEATURE_ENABLED: "1" } })).toEqual({
      enabled: false,
    });
    expect(resolveInviteFeatureConfig({ env: { INVITE_FEATURE_ENABLED: "TRUE" } })).toEqual({
      enabled: false,
    });
    expect(resolveInviteFeatureConfig({ env: { INVITE_FEATURE_ENABLED: "" } })).toEqual({
      enabled: false,
    });
  });

  it("INVITE_FEATURE_ENABLED='true'なら明示的にenabled(true)", () => {
    expect(resolveInviteFeatureConfig({ env: { INVITE_FEATURE_ENABLED: "true" } })).toEqual({
      enabled: true,
    });
  });
});
