import "server-only";

/**
 * 招待機能(1円モニター利用・Pilot先行利用の両方を含む、6fe056f以降のInvite機能全体)を
 * 有効化するかどうかの設定。billingConfig.ts / pilotInviteConfig.tsと同じ
 * discriminated unionパターン。デフォルトは必ずdisabled(明示的にtrueにしない限り
 * 機能しない)。
 *
 * 2026-09-29: リリース直前の履歴監査により、招待機能(招待発行・招待ページ・
 * 招待経由Checkout・Pilot先行利用)を10/1リリース対象から外すことになったが、
 * masterには既に別セッションの後続コミットが多数積まれているため、機能自体は
 * 削除せず「休眠」させる。このフラグがfalse(未設定時のデフォルト)の間は、
 * 公開招待ページ・招待発行API・招待経由Checkout/Pilotアクティベート・ops招待画面の
 * 全経路を閉じる。既存のStripe Price・Inviteデータ・Webhookの後方互換処理は
 * 一切削除・変更しない。
 */

export interface DisabledInviteFeatureConfig {
  enabled: false;
}

export interface EnabledInviteFeatureConfig {
  enabled: true;
}

export type InviteFeatureConfig = DisabledInviteFeatureConfig | EnabledInviteFeatureConfig;

export function resolveInviteFeatureConfig(options: {
  env: Record<string, string | undefined>;
}): InviteFeatureConfig {
  const raw = options.env.INVITE_FEATURE_ENABLED?.trim();
  if (raw !== "true") return { enabled: false };

  return { enabled: true };
}

export function resolveInviteFeatureConfigFromProcessEnv(): InviteFeatureConfig {
  return resolveInviteFeatureConfig({ env: process.env });
}
