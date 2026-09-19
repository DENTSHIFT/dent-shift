import "server-only";

export interface DisabledTimeRexWebhookConfig {
  provider: "disabled";
}

export interface EnabledTimeRexWebhookConfig {
  provider: "enabled";
  sharedSecret: string;
}

export type TimeRexWebhookConfig = DisabledTimeRexWebhookConfig | EnabledTimeRexWebhookConfig;

/**
 * TimeRex側のWebhook署名方式・ヘッダー名は契約/実装確認前のため未確定。
 * ここでは暫定的に共有シークレットのヘッダー突き合わせのみを行い、
 * 実際の署名検証方式が判明次第differentiate(STEP6報告事項)。
 */
export function resolveTimeRexWebhookConfig(options: {
  env: Record<string, string | undefined>;
}): TimeRexWebhookConfig {
  const sharedSecret = options.env.TIMEREX_WEBHOOK_SECRET?.trim();
  if (!sharedSecret) return { provider: "disabled" };
  return { provider: "enabled", sharedSecret };
}

export function resolveTimeRexWebhookConfigFromProcessEnv(): TimeRexWebhookConfig {
  return resolveTimeRexWebhookConfig({ env: process.env });
}
