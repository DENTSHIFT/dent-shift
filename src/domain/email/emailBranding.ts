// アプリメール(診断結果・認証・課金通知・パスワード再設定等)の共通シェル。
// ロゴ画像は入れない(ダークモードのメールクライアントで見え方が崩れるため)。
// TimeRexの予約通知メールはTimeRex管理画面側の設定であり、このモジュールの対象外。

/**
 * カード型の共通シェルでbodyHtmlを包む。課金通知・パスワード再設定メールなど、元々シェルを
 * 持たないテンプレート用(診断結果・メール確認メールは独自シェルを持つため使わない)。
 * 文面・リンクは一切変更しない。
 */
export function wrapEmailBodyHtml(bodyHtml: string): string {
  return `<!doctype html>
<html lang="ja">
  <body style="margin:0;background:#f5f7fa;color:#0f1b2d;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
    <div style="max-width:640px;margin:0 auto;padding:32px 20px">
      <div style="background:#ffffff;border:1px solid #e5e9f0;border-radius:16px;padding:28px">
        ${bodyHtml}
      </div>
    </div>
  </body>
</html>`;
}
