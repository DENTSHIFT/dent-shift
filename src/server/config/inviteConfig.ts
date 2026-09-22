import "server-only";

export class InviteConfigError extends Error {}

export interface InviteConfig {
  /** 招待作成時のデフォルトPrice ID(通常プランのPrice IDとは完全に別)。 */
  defaultStripePriceId: string;
}

export function resolveInviteConfig(options: {
  env: Record<string, string | undefined>;
}): InviteConfig {
  const defaultStripePriceId = options.env.STRIPE_PRICE_ID_INVITE_MONITOR?.trim();
  if (!defaultStripePriceId) {
    throw new InviteConfigError(
      "STRIPE_PRICE_ID_INVITE_MONITOR is required to create invite monitors."
    );
  }
  return { defaultStripePriceId };
}

export function resolveInviteConfigFromProcessEnv(): InviteConfig {
  return resolveInviteConfig({ env: process.env });
}
