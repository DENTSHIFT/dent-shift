import "server-only";

/**
 * 知人院長向け「パイロット先行利用」(Stripeを一切呼ばない)を
 * 有効化するかどうかの設定。billingConfig.ts / inviteConfig.tsと同じ
 * discriminated unionパターン。デフォルトは必ずdisabled(明示的に
 * enabledにしない限り機能しない)。
 *
 * 2026-09-23改訂: 従来はAPP_BASE_URLが本番ドメイン(dentshift.jp)の場合に
 * 強制的にdisabledへ落とす二重ガードを持っていたが、実医院を本番環境で
 * パイロット利用させる要件により撤廃した。
 *
 * 安全性は「ドメイン単位の一律解禁」ではなく「招待単位の限定解禁」で担保する:
 * - この設定(PILOT_INVITE_MODE=enabled)は「パイロット機能そのものの
 *   スイッチ」であり、これをenabledにしただけでは何も解禁されない
 * - 実際にパイロット導線へ入れるのは、運営者(Operator)がcampaign="pilot"を
 *   明示的に指定して発行した招待コードを知っている相手のみ(src/app/invite/[code]/page.tsx
 *   の isPilotInvite = invite?.campaign === "pilot" 判定、
 *   src/server/services/invites/activatePilotInvite.ts の
 *   invite.campaign !== "pilot" ガードを参照)
 * - 通常の招待(1円モニター等)・通常の会員登録・Stripe決済フローは
 *   この設定値を一切参照しない(別のresolveInviteConfigFromProcessEnv() /
 *   billingConfig.tsを使う独立した経路のため、影響しない)
 * - 本番でこの機能を使う場合は、Vercelの環境変数にPILOT_INVITE_MODE=enabledを
 *   明示的に設定する必要がある(未設定なら従来通りdisabledのまま)
 */

export interface DisabledPilotInviteConfig {
  mode: "disabled";
}

export interface EnabledPilotInviteConfig {
  mode: "enabled";
}

export type PilotInviteConfig = DisabledPilotInviteConfig | EnabledPilotInviteConfig;

export function resolvePilotInviteConfig(options: {
  env: Record<string, string | undefined>;
}): PilotInviteConfig {
  const rawMode = options.env.PILOT_INVITE_MODE?.trim();
  if (rawMode !== "enabled") return { mode: "disabled" };

  return { mode: "enabled" };
}

export function resolvePilotInviteConfigFromProcessEnv(): PilotInviteConfig {
  return resolvePilotInviteConfig({ env: process.env });
}
