import "server-only";

/**
 * 2026-09-29追加(PO指示): LLMOの3項目(crawler_access/structured_data/content_clarity)を
 * 実サイト取得(safeFetch経由)の結果から機械的に判定する、ネットワーク非依存の純粋関数群。
 * safeUrlFetcher.tsが取得した本文(HTML/robots.txt)だけを入力に取り、ここでは一切の
 * fetchを行わない(テスト容易性・SSRF対策の責務分離のため)。
 *
 * 外部URL・取得本文はこのモジュール内でもログへ出さない。
 */

export interface RobotsAnalysis {
  fetched: boolean;
  /** 主要AIクローラー(GPTBot/Google-Extended/ClaudeBot/CCBot等)を明示的にDisallowしていないか */
  allowsAiCrawlers: boolean;
  blockedUserAgents: string[];
}

const AI_CRAWLER_USER_AGENTS = ["GPTBot", "Google-Extended", "ClaudeBot", "CCBot", "PerplexityBot", "*"];

/**
 * robots.txtの本文を解析し、主要AIクローラーが明示的にDisallow: /されていないかを判定する。
 * 簡易パーサー: User-agentブロックごとにDisallow行を集計する(完全なrobots.txt仕様準拠では
 * ないが、「AIクローラーへのアクセス許可有無」という粗い判定には十分な精度とする)。
 */
export function analyzeRobotsTxt(body: string): RobotsAnalysis {
  const lines = body.split(/\r?\n/).map((l) => l.trim());
  const blockedUserAgents: string[] = [];
  let currentAgents: string[] = [];
  let blockAll = false;

  for (const line of lines) {
    if (line.startsWith("#") || line.length === 0) continue;
    const [rawKey, ...rest] = line.split(":");
    const key = (rawKey ?? "").trim().toLowerCase();
    const value = rest.join(":").trim();
    if (key === "user-agent") {
      // 直前がDisallowで終わっていなければ同一ブロックの継続として扱う簡易実装。
      currentAgents = [value];
    } else if (key === "disallow" && value === "/") {
      for (const agent of currentAgents) {
        const isAiAgent = AI_CRAWLER_USER_AGENTS.some(
          (a) => a.toLowerCase() === agent.toLowerCase()
        );
        if (isAiAgent) {
          blockedUserAgents.push(agent);
          if (agent === "*") blockAll = true;
        }
      }
    }
  }

  return {
    fetched: true,
    allowsAiCrawlers: !blockAll && blockedUserAgents.length === 0,
    blockedUserAgents,
  };
}

export interface NoindexAnalysis {
  hasNoindexMeta: boolean;
  hasNoindexHeader: boolean;
}

export function analyzeNoindex(html: string, xRobotsTagHeader: string | null): NoindexAnalysis {
  const metaMatch = html.match(/<meta[^>]+name=["']robots["'][^>]*>/i);
  const hasNoindexMeta = metaMatch ? /noindex/i.test(metaMatch[0]) : false;
  const hasNoindexHeader = xRobotsTagHeader ? /noindex/i.test(xRobotsTagHeader) : false;
  return { hasNoindexMeta, hasNoindexHeader };
}

export interface StructuredDataAnalysis {
  found: boolean;
  types: string[];
  hasMedicalRelevantType: boolean;
}

const MEDICAL_RELEVANT_TYPES = ["dentist", "medicalorganization", "localbusiness", "medicalbusiness", "physician"];

/**
 * HTML内の<script type="application/ld+json">を抽出し、@type(文字列 or 配列)を集計する。
 * JSONとして不正なブロックは無視する(1つでも有効なJSON-LDがあれば found=true)。
 */
export function analyzeStructuredData(html: string): StructuredDataAnalysis {
  const scriptRegex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const types = new Set<string>();
  let found = false;
  let match: RegExpExecArray | null;
  while ((match = scriptRegex.exec(html)) !== null) {
    try {
      const parsed = JSON.parse((match[1] ?? "").trim());
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        const graph = item && typeof item === "object" && "@graph" in item && Array.isArray(item["@graph"])
          ? item["@graph"]
          : [item];
        for (const node of graph) {
          if (!node || typeof node !== "object" || !("@type" in node)) continue;
          const rawType = (node as Record<string, unknown>)["@type"];
          const typeList = Array.isArray(rawType) ? rawType : [rawType];
          for (const t of typeList) {
            if (typeof t === "string" && t.length > 0) {
              types.add(t);
              found = true;
            }
          }
        }
      }
    } catch {
      // 不正なJSON-LDブロックはスキップする(取得失敗扱いにはしない)。
    }
  }
  const hasMedicalRelevantType = Array.from(types).some((t) =>
    MEDICAL_RELEVANT_TYPES.includes(t.toLowerCase())
  );
  return { found, types: Array.from(types), hasMedicalRelevantType };
}

export interface ContentClarityAnalysis {
  hasH1: boolean;
  headingCount: number;
  /** タグを除去した本文の推定文字数(空白を除く) */
  textLength: number;
  hasReadableContent: boolean;
}

export function analyzeContentClarity(html: string): ContentClarityAnalysis {
  const h1Count = (html.match(/<h1[\s>]/gi) ?? []).length;
  const h2Count = (html.match(/<h2[\s>]/gi) ?? []).length;
  const h3Count = (html.match(/<h3[\s>]/gi) ?? []).length;
  const headingCount = h1Count + h2Count + h3Count;

  // scriptタグ/styleタグの中身を除いてから、タグを除去して本文を推定する。
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  const text = withoutScripts.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const textLength = text.length;

  return {
    hasH1: h1Count > 0,
    headingCount,
    textLength,
    // 見出しが1つ以上あり、かつ本文相当のテキストが一定量(200文字)以上ある場合のみ
    // 「読み取れるコンテンツがある」とみなす(閾値は機械的判定のための最小限の目安)。
    hasReadableContent: headingCount > 0 && textLength >= 200,
  };
}
