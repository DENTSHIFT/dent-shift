import "server-only";

export interface DisabledResultEmailConfig {
  provider: "disabled";
}

export interface ResendResultEmailConfig {
  provider: "resend";
  apiKey: string;
  from: string;
  appBaseUrl: string;
}

export type ResultEmailConfig = DisabledResultEmailConfig | ResendResultEmailConfig;

export class ResultEmailConfigError extends Error {}

function resolveAppBaseUrl(rawValue: string): string {
  let url: URL;
  try {
    url = new URL(rawValue);
  } catch {
    throw new ResultEmailConfigError("APP_BASE_URL must be a valid absolute URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ResultEmailConfigError("APP_BASE_URL must use http or https.");
  }
  return url.origin;
}

/**
 * メール基盤は未確定のため既定値をdisabledとし、明示的にresendを選んだ場合だけ
 * 必須設定を検証する。API keyの値自体はエラー文へ一切含めない。
 */
export function resolveResultEmailConfig(options: {
  env: Record<string, string | undefined>;
}): ResultEmailConfig {
  const rawProvider = options.env.RESULT_EMAIL_PROVIDER?.trim() || "disabled";
  if (rawProvider === "disabled") return { provider: "disabled" };
  if (rawProvider !== "resend") {
    throw new ResultEmailConfigError(
      "RESULT_EMAIL_PROVIDER must be exactly 'disabled' or 'resend'."
    );
  }

  const apiKey = options.env.RESEND_API_KEY?.trim();
  const from = options.env.RESULT_EMAIL_FROM?.trim();
  const appBaseUrl = options.env.APP_BASE_URL?.trim();
  if (!apiKey) {
    throw new ResultEmailConfigError(
      "RESULT_EMAIL_PROVIDER='resend' requires RESEND_API_KEY."
    );
  }
  if (!from) {
    throw new ResultEmailConfigError(
      "RESULT_EMAIL_PROVIDER='resend' requires RESULT_EMAIL_FROM."
    );
  }
  if (!appBaseUrl) {
    throw new ResultEmailConfigError(
      "RESULT_EMAIL_PROVIDER='resend' requires APP_BASE_URL."
    );
  }

  return {
    provider: "resend",
    apiKey,
    from,
    appBaseUrl: resolveAppBaseUrl(appBaseUrl),
  };
}

export function resolveResultEmailConfigFromProcessEnv(): ResultEmailConfig {
  return resolveResultEmailConfig({ env: process.env });
}

/**
 * 2026-09-29追加(PO承認、認証導線の環境またぎ対策P0): メール確認・パスワード
 * 再設定リンクだけが使う、任意のホスト上書き設定。
 *
 * 背景: APP_BASE_URLはPreview環境全体で共有される単一の値のため、どのブランチの
 * Previewで検証していても、メール内リンクは常に同じ固定ホストへ向かい、検証中の
 * ブランチへ戻れなかった(ログイン状態も引き継がれない)。任意のリクエストHostヘッダー
 * をそのまま信用してリンクを生成することはしない(Host Header Injection対策)。
 * 代わりに、許可リスト方式の専用環境変数`EMAIL_LINK_BASE_URL`を用意し、明示的に
 * 設定された場合のみAPP_BASE_URLの代わりに使う(未設定時は常にAPP_BASE_URLのまま、
 * 本番の挙動は一切変わらない)。
 *
 * 値はHTTPSのみ許可する(HTTP・その他schemeは拒否)。このヘルパーはメール確認
 * (sendEmailVerification.ts)とパスワード再設定(sendContactPasswordResetEmail.ts)の
 * 2箇所からのみ呼ぶ想定(PO指示の適用範囲)。Stripe Checkout等、他の`appBaseUrl`
 * 利用箇所には一切影響しない。
 */
export function resolveEmailLinkBaseUrl(
  env: Record<string, string | undefined>,
  fallbackAppBaseUrl: string
): string {
  const override = env.EMAIL_LINK_BASE_URL?.trim();
  if (!override) return fallbackAppBaseUrl;

  // 不正な値(HTTPS以外・URLとして解釈不能)の場合は、メール送信自体を止めず
  // APP_BASE_URLへ安全にフォールバックする(このQA専用上書き設定の誤設定が、
  // 本番相当のメール送信フロー全体を止める理由にはしない)。
  let url: URL;
  try {
    url = new URL(override);
  } catch {
    console.warn("[resolveEmailLinkBaseUrl] EMAIL_LINK_BASE_URL is not a valid URL; falling back to APP_BASE_URL.");
    return fallbackAppBaseUrl;
  }
  if (url.protocol !== "https:") {
    console.warn("[resolveEmailLinkBaseUrl] EMAIL_LINK_BASE_URL must use https; falling back to APP_BASE_URL.");
    return fallbackAppBaseUrl;
  }
  return url.origin;
}

export function resolveEmailLinkBaseUrlFromProcessEnv(fallbackAppBaseUrl: string): string {
  return resolveEmailLinkBaseUrl(process.env, fallbackAppBaseUrl);
}
