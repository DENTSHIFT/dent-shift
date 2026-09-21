import "server-only";
import muhammara from "muhammara";

/**
 * PDF標準暗号化(/Encrypt辞書)でユーザーパスワードを付与する。
 * userPassword: PDFを開く際に要求されるパスワード(制作会社へ渡す値)。
 * ownerPassword: 印刷/編集等の権限制御用の別パスワード。ユーザーパスワードとは
 * 別のランダム値を使い、呼び出し側には返さない(権限バイパス目的の推測を避けるため)。
 */
export async function protectPdfWithPassword(
  pdfBytes: Uint8Array,
  userPassword: string
): Promise<Buffer> {
  const { randomBytes } = await import("node:crypto");
  const ownerPassword = randomBytes(16).toString("hex");

  const inputStream = new muhammara.PDFRStreamForBuffer(Buffer.from(pdfBytes));
  const outputStream = new muhammara.PDFWStreamForBuffer();
  muhammara.recrypt(inputStream, outputStream, {
    userPassword,
    ownerPassword,
    // 印刷は許可、内容の改変・コピーは禁止(制作会社が参照のみできればよい)。
    userProtectionFlag: 4,
  });
  return outputStream.buffer;
}
