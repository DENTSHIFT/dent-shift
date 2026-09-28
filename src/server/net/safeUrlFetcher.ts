import "server-only";
import dns from "node:dns/promises";
import net from "node:net";

/**
 * 2026-09-29追加(PO指示): 医院が入力した任意のURL(サーバー内部・クラウドメタデータ等
 * を含みうる)へ、サーバー側から直接fetchするための、SSRF対策を必須要件として満たす
 * 専用モジュール。LLMO実測(website-analysis)からのみ使用する。
 *
 * 満たすセキュリティ要件(PO指示、全て必須):
 * - https/httpのみ許可
 * - localhost/ループバック/プライベートIP/リンクローカル/メタデータIPを拒否
 * - DNS解決後のIPも検証(DNS rebinding対策)
 * - リダイレクト先も毎回同じ検証を行う(自動リダイレクトを無効化し手動で1段ずつ検証)
 * - 80/443以外のポートを禁止
 * - 応答サイズ上限・タイムアウト・リダイレクト回数上限
 * - Content-TypeはHTML/text/robots.txt相当のみ許可
 * - Cookie・Authorization・認証情報を一切転送しない(新規fetchのため元々含まれない設計)
 * - 外部URL・取得本文をログへ出さない(呼び出し側も含め、この方針を徹底する)
 */

export const MAX_REDIRECTS = 3;
export const FETCH_TIMEOUT_MS = 5000;
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024; // 2MB
const ALLOWED_SCHEMES = new Set(["http:", "https:"]);
const ALLOWED_PORTS = new Set(["", "80", "443"]);
// Content-Type許可リスト(charset等のパラメータ部分は呼び出し側で個別に無視して判定する)
const ALLOWED_CONTENT_TYPE_PREFIXES = [
  "text/html",
  "text/plain",
  "application/xhtml+xml",
];

export type SafeFetchFailureReason =
  | "invalid_url"
  | "disallowed_scheme"
  | "disallowed_port"
  | "blocked_host"
  | "dns_resolution_failed"
  | "blocked_resolved_ip"
  | "too_many_redirects"
  | "redirect_target_invalid"
  | "network_error"
  | "timeout"
  | "response_too_large"
  | "disallowed_content_type"
  | "http_error";

export interface SafeFetchSuccess {
  ok: true;
  status: number;
  contentType: string | null;
  xRobotsTag: string | null;
  body: string;
  finalUrl: string;
}

export interface SafeFetchFailure {
  ok: false;
  reason: SafeFetchFailureReason;
  status?: number;
}

export type SafeFetchResult = SafeFetchSuccess | SafeFetchFailure;

/**
 * IPv4/IPv6アドレスが、外部公開サーバーとして到達させてはいけない範囲かどうかを判定する。
 * ループバック・プライベート・リンクローカル・マルチキャスト・主要クラウドの
 * メタデータエンドポイント(169.254.169.254等、リンクローカル範囲に含まれるため
 * 実質的に同条件で拒否される)を対象にする。
 */
export function isBlockedIp(ip: string): boolean {
  const type = net.isIP(ip);
  if (type === 4) {
    const parts = ip.split(".").map(Number);
    if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true; // 不正形式は拒否側
    const a = parts[0] ?? 0;
    const b = parts[1] ?? 0;
    if (a === 127) return true; // loopback
    if (a === 10) return true; // private
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 169 && b === 254) return true; // link-local(クラウドメタデータ含む)
    if (a === 0) return true; // "this network"
    if (a >= 224) return true; // multicast/reserved
    return false;
  }
  if (type === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::1") return true; // loopback
    if (lower.startsWith("fe80:") || lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return true; // link-local
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local(private相当)
    if (lower.startsWith("::ffff:")) {
      // IPv4-mapped IPv6。埋め込まれたIPv4側を再検証する。
      const mapped = lower.replace("::ffff:", "");
      if (net.isIP(mapped) === 4) return isBlockedIp(mapped);
      return true;
    }
    return false;
  }
  // IPとして解釈できない値は安全側で拒否
  return true;
}

function isBlockedHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (lower === "localhost" || lower.endsWith(".localhost")) return true;
  if (lower === "metadata.google.internal") return true;
  // 数値IPとしてそのまま入力された場合はここでも判定する(DNS解決をバイパスするケース)。
  if (net.isIP(lower) !== 0) return isBlockedIp(lower);
  return false;
}

export type DnsLookupFn = (hostname: string) => Promise<string[]>;

async function defaultDnsLookup(hostname: string): Promise<string[]> {
  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  return records.map((r) => r.address);
}

async function resolveAndValidateHost(
  hostname: string,
  lookup: DnsLookupFn
): Promise<boolean> {
  if (isBlockedHostname(hostname)) return false;
  if (net.isIP(hostname) !== 0) return !isBlockedIp(hostname);
  let addresses: string[];
  try {
    addresses = await lookup(hostname);
  } catch {
    return false;
  }
  if (addresses.length === 0) return false;
  // DNS rebinding対策: 解決された全アドレスが安全でなければ拒否する。
  return addresses.every((addr) => !isBlockedIp(addr));
}

function validateUrlShape(rawUrl: string): { ok: true; url: URL } | { ok: false; reason: SafeFetchFailureReason } {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }
  if (!ALLOWED_SCHEMES.has(url.protocol)) {
    return { ok: false, reason: "disallowed_scheme" };
  }
  if (!ALLOWED_PORTS.has(url.port)) {
    return { ok: false, reason: "disallowed_port" };
  }
  if (url.username || url.password) {
    // URL埋め込みの認証情報を持つリクエストは転送しない方針のため、形式自体を拒否する。
    return { ok: false, reason: "invalid_url" };
  }
  return { ok: true, url };
}

function isAllowedContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  const base = (contentType.split(";")[0] ?? "").trim().toLowerCase();
  return ALLOWED_CONTENT_TYPE_PREFIXES.includes(base);
}

export interface SafeFetchOverrides {
  /** テスト専用: 実DNS解決の代わりに使うlookup関数。省略時は実DNS(node:dns)を使う。 */
  dnsLookup?: DnsLookupFn;
  /** テスト専用: 実fetchの代わりに使うfetch実装(fake transport)。省略時はグローバルfetchを使う。 */
  fetchImpl?: typeof fetch;
}

/**
 * SSRF対策を満たした上で、指定URLをGETする。呼び出し側はurl/bodyを一切ログへ出さないこと。
 */
export async function safeFetch(
  rawUrl: string,
  overrides: SafeFetchOverrides = {}
): Promise<SafeFetchResult> {
  const dnsLookup = overrides.dnsLookup ?? defaultDnsLookup;
  const fetchImpl = overrides.fetchImpl ?? fetch;
  let currentUrl = rawUrl;
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    const shape = validateUrlShape(currentUrl);
    if (!shape.ok) return { ok: false, reason: shape.reason };
    const { url } = shape;

    const hostOk = await resolveAndValidateHost(url.hostname, dnsLookup);
    if (!hostOk) return { ok: false, reason: "blocked_resolved_ip" };

    let response: Response;
    try {
      response = await fetchImpl(url.toString(), {
        method: "GET",
        redirect: "manual", // リダイレクトを自動追跡せず、毎回このループで検証する
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: {
          // Cookie/Authorization等は元々このリクエストに含めない(新規fetchのため転送されうる
          // ものが存在しない)。User-Agentのみ明示し、robots.txt解析で参照できるようにする。
          "User-Agent": "DentShiftLlmoAudit/1.0 (+https://dentshift.jp)",
        },
      });
    } catch (err) {
      if (err instanceof Error && err.name === "TimeoutError") {
        return { ok: false, reason: "timeout" };
      }
      return { ok: false, reason: "network_error" };
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return { ok: false, reason: "redirect_target_invalid" };
      let nextUrl: URL;
      try {
        nextUrl = new URL(location, url);
      } catch {
        return { ok: false, reason: "redirect_target_invalid" };
      }
      if (redirectCount === MAX_REDIRECTS) {
        return { ok: false, reason: "too_many_redirects" };
      }
      currentUrl = nextUrl.toString();
      continue; // 次のループでリダイレクト先を最初から検証する
    }

    if (!response.ok) {
      return { ok: false, reason: "http_error", status: response.status };
    }

    const contentType = response.headers.get("content-type");
    const xRobotsTag = response.headers.get("x-robots-tag");
    // robots.txtはtext/plainで返るサーバーが多いため、上記許可リストでカバーする。
    if (!isAllowedContentType(contentType)) {
      return { ok: false, reason: "disallowed_content_type" };
    }

    const contentLengthHeader = response.headers.get("content-length");
    if (contentLengthHeader && Number(contentLengthHeader) > MAX_RESPONSE_BYTES) {
      return { ok: false, reason: "response_too_large" };
    }

    if (!response.body) {
      return { ok: true, status: response.status, contentType, xRobotsTag, body: "", finalUrl: url.toString() };
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > MAX_RESPONSE_BYTES) {
          await reader.cancel().catch(() => {});
          return { ok: false, reason: "response_too_large" };
        }
        chunks.push(value);
      }
    } catch {
      return { ok: false, reason: "network_error" };
    }
    const body = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf-8");
    return { ok: true, status: response.status, contentType, xRobotsTag, body, finalUrl: url.toString() };
  }
  return { ok: false, reason: "too_many_redirects" };
}
