/**
 * オープンリダイレクト対策: ログイン後などのリダイレクト先として、同一サイト内の
 * 相対パスのみを許可する。login/page.tsx・verify-phone/page.tsxに重複していた
 * 同一ロジックをここに集約(2026-09-25、セキュリティレビュー指摘対応)。
 *
 * 許可: "/"始まりかつ"//"始まりでない値("/dashboard"、"/diagnosis/result/xxx"等)
 * 拒否: "https://..."、"//evil.example"(プロトコル相対URL)、"javascript:..."、
 *       バックスラッシュを含む値("/\evil.example"は一部ブラウザが"//evil.example"に
 *       正規化してしまうため、"//"チェックだけでは防げない既知のバイパス手口)
 */
export function safeNextPath(next: string | undefined | null): string | null {
  if (!next) return null;
  if (!next.startsWith("/") || next.startsWith("//")) return null;
  if (next.includes("\\")) return null;
  return next;
}
