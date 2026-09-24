// 2026-09-24: DENT SHIFTから送信するアプリメール(診断結果・認証・課金通知等)の
// ヘッダーロゴを統一する。LPヘッダー(src/components/marketing/MarketingHeader.tsx)と
// 同じ正式ロゴファイルを、メールクライアントが読み込める公開HTTPS URLとして使う
// (相対パスはメールクライアントで解決できないため必ず絶対URLにする)。
// TimeRexの予約通知メールはTimeRex管理画面側の設定であり、このモジュールの対象外。
export const DENT_SHIFT_EMAIL_LOGO_URL =
  "https://dentshift.jp/brand/logo/DENT_SHIFT_horizontal_tagline_transparent.png";

/**
 * 全メールテンプレート共通のロゴヘッダーHTML。
 * alt="DENT SHIFT"により、画像非表示設定のメールクライアントでもテキストで
 * 送信元が分かる(公開ガイドpublic/brand/logo/README_使用ガイド.mdの「縦横比を
 * 変更しない」に従い、width/heightは元画像比率(1844:572)を保つ)。
 */
export function buildEmailLogoHeaderHtml(): string {
  return `<div style="margin-bottom:20px;">
          <img src="${DENT_SHIFT_EMAIL_LOGO_URL}" alt="DENT SHIFT" width="160" height="50" style="display:block;width:160px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;">
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
