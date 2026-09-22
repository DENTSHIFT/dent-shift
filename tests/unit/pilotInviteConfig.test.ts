import { describe, expect, it } from "vitest";
import { resolvePilotInviteConfig } from "@/server/config/pilotInviteConfig";

describe("resolvePilotInviteConfig", () => {
  it("PILOT_INVITE_MODE未設定ならdisabled", () => {
    expect(resolvePilotInviteConfig({ env: {} })).toEqual({ mode: "disabled" });
  });

  it("PILOT_INVITE_MODEが'enabled'以外ならdisabled", () => {
    expect(
      resolvePilotInviteConfig({ env: { PILOT_INVITE_MODE: "true" } })
    ).toEqual({ mode: "disabled" });
  });

  it("PILOT_INVITE_MODE=enabledかつ本番APP_BASE_URLでなければenabled", () => {
    expect(
      resolvePilotInviteConfig({
        env: { PILOT_INVITE_MODE: "enabled", APP_BASE_URL: "https://test.dentshift.jp" },
      })
    ).toEqual({ mode: "enabled" });
  });

  it("APP_BASE_URL未設定でもenabledになる(ローカル開発想定)", () => {
    expect(resolvePilotInviteConfig({ env: { PILOT_INVITE_MODE: "enabled" } })).toEqual({
      mode: "enabled",
    });
  });

  it("APP_BASE_URLが本番ドメインの場合は強制的にdisabled(二重ガード)", () => {
    expect(
      resolvePilotInviteConfig({
        env: { PILOT_INVITE_MODE: "enabled", APP_BASE_URL: "https://dentshift.jp" },
      })
    ).toEqual({ mode: "disabled" });
  });
});
