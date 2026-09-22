import "server-only";

/**
 * 知人院長向け「パイロット先行利用」(test環境限定、Stripeを一切呼ばない)を
 * 有効化するかどうかの設定。billingConfig.ts / inviteConfig.tsと同じ
 * discriminated unionパターン。デフォルトは必ずdisabled(明示的に
 * enabledにしない限り機能しない)。
 *
 * production側の絶対的な安全策は「Vercel dent-shift-productionの環境変数に
 * PILOT_INVITE_MODEを一切登録しない」こと(未設定=disabled)。加えて、
 * APP_BASE_URLが本番ドメイン(dentshift.jp)を指している場合は、たとえ
 * PILOT_INVITE_MODE=enabledが誤って設定されても強制的に無効化する
 * 二重ガードを resolvePilotInviteConfig 内に持つ。
 */

export interface DisabledPilotInviteConfig {
  mode: "disabled";
}

export interface EnabledPilotInviteConfig {
  mode: "enabled";
}

export type PilotInviteConfig = DisabledPilotInviteConfig | EnabledPilotInviteConfig;

const PRODUCTION_APP_BASE_URL = "https://dentshift.jp";

export function resolvePilotInviteConfig(options: {
  env: Record<string, string | undefined>;
}): PilotInviteConfig {
  const rawMode = options.env.PILOT_INVITE_MODE?.trim();
  if (rawMode !== "enabled") return { mode: "disabled" };

  const appBaseUrl = options.env.APP_BASE_URL?.trim();
  if (appBaseUrl === PRODUCTION_APP_BASE_URL) {
    // 本番ドメイン向けの設定では、誤って環境変数が投入されていても常に無効化する。
    return { mode: "disabled" };
  }

  return { mode: "enabled" };
}

export function resolvePilotInviteConfigFromProcessEnv(): PilotInviteConfig {
  return resolvePilotInviteConfig({ env: process.env });
}
