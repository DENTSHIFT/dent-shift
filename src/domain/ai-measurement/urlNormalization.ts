/**
 * citation URL正規化(設計書G章: 自院公式サイトの判定)。
 * 「citationが存在する」ことと「自院公式サイトがcitationされた」ことを分離して判定する
 * ための下請け関数。実ネットワーク呼び出し(redirect追跡)は行わない
 * (設計書G章: P0ではredirect追跡はせず、記載URLをそのまま正規化して判定する)。
 */

export interface NormalizedUrl {
  /** 正規化後のhost(www.を除去、小文字化)。 */
  host: string;
  /** 正規化後のpath(trailing slashを除去。ルートは"/"のまま)。 */
  path: string;
}

/**
 * URLを正規化する。protocol(http/https)・大文字小文字・www有無・trailing slash・
 * queryパラメータ・fragmentの違いを比較に影響させない(設計書G章)。
 * subdomain(clinic.example.comのような)は今回はwww.のみを特別扱いし、それ以外の
 * subdomainは別hostとして扱う(同一医院とみなす範囲は未確定。最終報告の未解決事項参照)。
 * 不正なURLはnullを返す(値を握りつぶさず、呼び出し側が「判定不能」を区別できるようにする)。
 */
export function normalizeUrl(rawUrl: string): NormalizedUrl | null {
  let parsed: URL;
  try {
    // "example.com"のようなprotocol無し入力にも対応する(citationが常にhttps://付きとは限らない)。
    parsed = new URL(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(rawUrl) ? rawUrl : `https://${rawUrl}`);
  } catch {
    return null;
  }

  let host = parsed.hostname.toLowerCase();
  if (host.startsWith("www.")) {
    host = host.slice("www.".length);
  }

  let path = parsed.pathname;
  if (path.length > 1 && path.endsWith("/")) {
    path = path.slice(0, -1);
  }
  if (path === "") {
    path = "/";
  }

  // queryパラメータ・fragmentは意図的に破棄する(ドメイン一致判定に影響させない、設計書G章)。
  return { host, path };
}

/**
 * 2つのURLが同一の(www有無・trailing slash・protocol・大文字小文字・query/fragmentの
 * 違いを除いた)「同一ページ」を指すかを判定する。
 */
export function isSameNormalizedUrl(urlA: string, urlB: string): boolean {
  const a = normalizeUrl(urlA);
  const b = normalizeUrl(urlB);
  if (a === null || b === null) return false;
  return a.host === b.host && a.path === b.path;
}

/**
 * citation URLのhostが、officialHost自身か、その正式なsubdomainであるかを判定する
 * (2026-09-07のユーザー指示によりP0のsubdomain扱いを確定)。
 * 例: officialHost="example-clinic.jp"のとき、
 *   - "example-clinic.jp"        → true(完全一致)
 *   - "www.example-clinic.jp"    → true(normalizeUrlでwww除去済みなので完全一致になる)
 *   - "reserve.example-clinic.jp" → true(正式なsubdomain)
 *   - "blog.example-clinic.jp"    → true(正式なsubdomain)
 *   - "evil-example-clinic.jp"    → false(生のsubstring/endsWith一致だけだと
 *     "example-clinic.jp"を末尾に含んでしまい誤って一致してしまう。必ず
 *     "." + officialHost という区切り文字境界を含めて判定することで、
 *     ハイフン等で連結された別ドメインを弾く)
 *   - "example-clinic.jp.other-domain.com" → false(officialHostは末尾ではなく
 *     ドメインの途中に出現しているだけであり、正しい末尾一致にならない)
 * redirectの実ネットワーク追跡は今回行わない(記載URLをそのまま正規化して判定する)。
 */
export function isHostOrSubdomainOfOfficialHost(host: string, officialHost: string): boolean {
  if (host === officialHost) return true;
  return host.endsWith(`.${officialHost}`);
}

/**
 * citation URLが、医院の公式ドメイン(またはその正式なsubdomain)かを判定する
 * (パスは見ない。公式サイト内・その正式なsubdomain内のどのページが引用されても
 * 「自院公式サイトがcitationされた」とみなす)。
 */
export function isSameOfficialDomain(citationUrl: string, officialClinicUrl: string): boolean {
  const citation = normalizeUrl(citationUrl);
  const official = normalizeUrl(officialClinicUrl);
  if (citation === null || official === null) return false;
  return isHostOrSubdomainOfOfficialHost(citation.host, official.host);
}
