import { randomInt } from "node:crypto";

// 紛らわしい文字(0/O, 1/I/l等)を除いた記号なしの読み上げやすい文字集合。
// 制作会社側へ電話・チャットで口頭伝達される可能性を考慮する。
const PASSWORD_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const PASSWORD_LENGTH = 12;

/**
 * 生成PDFの閲覧パスワードを暗号学的乱数で生成する。平文はDBに保存せず、
 * 呼び出し側でpasswordHash(照合用)とpasswordEncrypted(再表示用)へ分離して保存する。
 */
export function generateInstructionPdfPassword(): string {
  let password = "";
  for (let i = 0; i < PASSWORD_LENGTH; i++) {
    password += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)];
  }
  return password;
}
