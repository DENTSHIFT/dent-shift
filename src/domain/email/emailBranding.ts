// 2026-09-24: DENT SHIFTから送信するアプリメール(診断結果・認証・課金通知等)の
// ヘッダーロゴを統一する。LPヘッダー(src/components/marketing/MarketingHeader.tsx)と
// 同じ正式ロゴファイルを、メールクライアントが読み込める公開HTTPS URLとして使う
// (相対パスはメールクライアントで解決できないため必ず絶対URLにする)。
// TimeRexの予約通知メールはTimeRex管理画面側の設定であり、このモジュールの対象外。
// メール用の正式ロゴ: 正式ロゴ(DENT_SHIFT_horizontal_tagline_transparent.png)を白背景に
// 合成しただけのコピー(デザイン・色・縦横比は変更しない)。透過PNGのままだと、ダークモードの
// メールクライアントで濃紺の文字が背景に溶けて黒く見えるため、不透明な白背景で固定する。
const EMAIL_LOGO_PATH = "/brand/logo/DENT_SHIFT_email_official.png";
const PRODUCTION_ORIGIN = "https://dentshift.jp";

// アプリ自身のオリジン(APP_BASE_URL)から配信する。test環境ではtest側の同一アセットを参照でき、
// 本番では既定のdentshift.jpになる。未設定・不正な値は本番オリジンにフォールバックする。
export function getEmailLogoUrl(env: Record<string, string | undefined> = process.env): string {
  let origin = PRODUCTION_ORIGIN;
  const configured = env.APP_BASE_URL?.trim();
  if (configured) {
    try {
      const url = new URL(configured);
      if (url.protocol === "https:") origin = url.origin;
    } catch {
      // 不正な値は既定のオリジンを使う。
    }
  }
  return `${origin}${EMAIL_LOGO_PATH}`;
}

/**
 * 全メールテンプレート共通のロゴヘッダーHTML。
 * ロゴ周辺は白背景を明示し(bgcolor + background)、ダークモードでも不自然に見えないようにする。
 * alt="DENT SHIFT"により、画像非表示のメールクライアントでも送信元が分かる。
 * width/heightは元画像比率(640:199)を保つ。
 */
export function buildEmailLogoHeaderHtml(): string {
  return `<div bgcolor="#ffffff" style="margin-bottom:20px;background:#ffffff;padding:4px 0;">
          <img src="${getEmailLogoUrl()}" alt="DENT SHIFT" width="160" height="50" style="display:block;width:160px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;background:#ffffff;">
        </div>`;
}

/**
 * ロゴヘッダー付きの共通カード型シェルでbodyHtmlを包む。
 * 課金通知・管理者パスワード再設定メールなど、元々シェルを持たないテンプレート用
 * (診断結果・メール確認メールは既存の独自シェルにbuildEmailLogoHeaderHtml()のみ
 * 差し込んでいるため、このヘルパーは使わない)。文面・リンクは一切変更しない。
 */
export function wrapEmailBodyHtml(bodyHtml: string): string {
  return `<!doctype html>
<html lang="ja">
  <body style="margin:0;background:#f5f7fa;color:#0f1b2d;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
    <div style="max-width:640px;margin:0 auto;padding:32px 20px">
      <div style="background:#ffffff;border:1px solid #e5e9f0;border-radius:16px;padding:28px">
        ${buildEmailLogoHeaderHtml()}
        ${bodyHtml}
      </div>
    </div>
  </body>
</html>`;
}
