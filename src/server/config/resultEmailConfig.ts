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
 * 【ホスト許可リスト(2026-09-29のPO指摘への対応)】
 * HTTPSであることだけでは、EMAIL_LINK_BASE_URLの値を勝手に外部から書き換えられた
 * 場合の防御にならない(schemeを満たす任意ホストを許可してしまう)。そのため、
 * `EMAIL_LINK_ALLOWED_HOSTS`(カンマ区切りのホスト名リスト)を別途用意し、
 * EMAIL_LINK_BASE_URLのホスト名がこのリストに含まれる場合のみ採用する。
 * 許可リスト自体が未設定の場合は、EMAIL_LINK_BASE_URLが設定されていても採用せず、
 * 従来どおりAPP_BASE_URLを使う動作へフォールバックする(「許可リストが無ければ
 * 何でも許可」にはしない。メール送信自体を止めるものではなく、あくまで
 * EMAIL_LINK_BASE_URL導入前の標準動作に戻るだけ)。
 * 対象ブランチのPreview環境変数として、そのブランチのAlias/デプロイ固有ホスト名
 * だけを`EMAIL_LINK_ALLOWED_HOSTS`へ設定する運用を想定する(下記
 * resolveEmailLinkBaseUrlFromProcessEnv側のコメント参照)。
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

  const allowedHosts = (env.EMAIL_LINK_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter((host) => host.length > 0);
  if (allowedHosts.length === 0) {
    console.warn(
      "[resolveEmailLinkBaseUrl] EMAIL_LINK_ALLOWED_HOSTS is not set (HTTPS alone is not a host " +
        "allow-list); EMAIL_LINK_BASE_URL is not applied and email links fall back to the standard " +
        "APP_BASE_URL behavior."
    );
    return fallbackAppBaseUrl;
  }
  if (!allowedHosts.includes(url.hostname.toLowerCase())) {
    console.warn(
      "[resolveEmailLinkBaseUrl] EMAIL_LINK_BASE_URL host is not in EMAIL_LINK_ALLOWED_HOSTS; falling back to APP_BASE_URL."
    );
    return fallbackAppBaseUrl;
  }

  return url.origin;
}

export function resolveEmailLinkBaseUrlFromProcessEnv(fallbackAppBaseUrl: string): string {
  return resolveEmailLinkBaseUrl(process.env, fallbackAppBaseUrl);
}
