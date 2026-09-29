import "server-only";
import { createHash } from "node:crypto";

/**
 * 2026-09-29追加(再診断ループの連続実行対策P0): レート制限のスコープキーとして
 * 使うため、リクエスト元IPを取得しSHA-256でハッシュ化する(生IPをDBへ保存しない)。
 * VercelはX-Forwarded-Forの先頭(クライアントに最も近いホップ)に実際の接続元IPを
 * 設定する。ヘッダーが無い場合(ローカル開発等)は固定文字列にフォールバックする
 * (この場合IPスコープでの区別自体ができないため、実運用のVercel環境でのみ意味を持つ)。
 */
export function extractClientIp(headers: Headers): string {
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}

export function hashClientIp(ip: string): string {
  return createHash("sha256").update(ip).digest("hex");
}
