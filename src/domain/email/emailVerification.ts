import { buildEmailLogoHeaderHtml } from "./emailBranding";

export interface EmailVerificationMessage {
  subject: string;
  text: string;
  html: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * メールアドレス確認メールの表示内容を組み立てる純粋関数(diagnosisResultEmail.tsと同形)。
 */
export function buildEmailVerificationMessage(input: {
  clinicName: string;
  verifyUrl: string;
}): EmailVerificationMessage {
  const escapedClinicName = escapeHtml(input.clinicName);
  const escapedVerifyUrl = escapeHtml(input.verifyUrl);

  const text = [
    `${input.clinicName} ご担当者様`,
    "",
    "DENT SHIFTの無料トライアル登録ありがとうございます。",
    "以下のリンクからメールアドレスの確認を完了してください（24時間有効）。",
    "",
    input.verifyUrl,
    "",
    "心当たりのない場合は、このメールを破棄してください。",
  ].join("\n");

  const html = `<!doctype html>
<html lang="ja">
  <body style="margin:0;background:#f5f7fa;color:#0f1b2d;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
    <div style="max-width:640px;margin:0 auto;padding:32px 20px">
      <div style="background:#ffffff;border:1px solid #e5e9f0;border-radius:16px;padding:28px">
        ${buildEmailLogoHeaderHtml()}
        <p>${escapedClinicName} ご担当者様</p>
        <h1 style="font-size:22px;margin:20px 0 12px">メールアドレスの確認をお願いします</h1>
        <p>DENT SHIFTの無料トライアル登録ありがとうございます。以下のボタンからメールアドレスの確認を完了してください（24時間有効）。</p>
        <p style="margin:28px 0">
          <a href="${escapedVerifyUrl}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:10px">メールアドレスを確認する</a>
        </p>
        <p style="font-size:12px;color:#6b7280">心当たりのない場合は、このメールを破棄してください。</p>
      </div>
    </div>
  </body>
</html>`;

  return {
    subject: "【DENT SHIFT】メールアドレスの確認をお願いします",
    text,
    html,
  };
}
