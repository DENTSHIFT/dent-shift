import { isSameOfficialDomain } from "./urlNormalization";

/**
 * clinic mention判定(設計書7章・G章)。
 * 単純なincludes()だけで確定させず、「医院正式名称・表記ゆれ(エイリアス)」による
 * テキストマッチと、「citationが自院公式ドメインを指しているか」を、別々の事実として
 * 分離して返す構造にする(2026-09-07のユーザー指示)。
 * P0では複雑なfuzzy matchingライブラリを新規導入せず、正規化した部分文字列マッチのみを
 * 使う(設計書7章)。判定ロジックは副作用の無い純粋関数。
 */

export interface ClinicMentionMatchInput {
  responseText: string;
  clinicName: string;
  /** 通称・旧名称・法人格違い等の表記ゆれ候補(任意)。 */
  clinicNameAliases?: string[];
  officialClinicUrl: string;
  citations: string[];
}

export interface ClinicMentionMatchResult {
  /** 応答本文に医院名(または既知のエイリアス)が出現したか。 */
  mentioned: boolean;
  /** 実際にマッチした名称文字列(clinicNameまたはaliasesのいずれか)。 */
  matchedNameVariant: string | null;
  /** マッチ箇所の前後を含む短いテキストスパン(evidence用)。 */
  evidenceSnippet: string | null;
  /** 正規化後テキスト内でのマッチ開始位置(言及順によるrank推定に使う。未マッチはnull)。 */
  matchedIndex: number | null;
  /** citationsのいずれかが自院公式ドメインと一致するか(mention判定そのものとは独立)。 */
  officialDomainCited: boolean;
  /** officialDomainCited=trueのとき、一致したcitation URL。 */
  matchedCitationUrl: string | null;
}

const EVIDENCE_SNIPPET_RADIUS = 20;

/**
 * 全角英数・全角スペースを半角へ寄せ、連続空白を1つに畳み、前後をtrimする
 * (設計書7章「正規化(全角/半角、法人格表記ゆれの除去等)」のうち、P0で対応する最小限)。
 * 法人格(医療法人社団 等)の除去のような高度な表記ゆれ吸収は今回のスコープ外とし、
 * aliases側に呼び出し元が候補を用意する前提とする(最終報告の未解決事項参照)。
 */
export function normalizeForMatching(text: string): string {
  const halfWidth = text.replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0)
  );
  return halfWidth.replace(/[\s　]+/g, " ").trim();
}

export function matchClinicMention(input: ClinicMentionMatchInput): ClinicMentionMatchResult {
  const candidates = [input.clinicName, ...(input.clinicNameAliases ?? [])].filter(
    (name) => name.trim().length > 0
  );
  const normalizedText = normalizeForMatching(input.responseText);

  let matchedNameVariant: string | null = null;
  let matchedIndex: number | null = null;
  for (const candidate of candidates) {
    const normalizedCandidate = normalizeForMatching(candidate);
    if (normalizedCandidate.length === 0) continue;
    const idx = normalizedText.indexOf(normalizedCandidate);
    if (idx !== -1) {
      matchedNameVariant = candidate;
      matchedIndex = idx;
      break;
    }
  }

  const mentioned = matchedNameVariant !== null;
  const evidenceSnippet =
    mentioned && matchedIndex !== null
      ? buildEvidenceSnippet(normalizedText, matchedIndex, matchedNameVariant!.length)
      : null;

  let officialDomainCited = false;
  let matchedCitationUrl: string | null = null;
  for (const citation of input.citations) {
    if (isSameOfficialDomain(citation, input.officialClinicUrl)) {
      officialDomainCited = true;
      matchedCitationUrl = citation;
      break;
    }
  }

  return {
    mentioned,
    matchedNameVariant,
    evidenceSnippet,
    matchedIndex,
    officialDomainCited,
    matchedCitationUrl,
  };
}

function buildEvidenceSnippet(text: string, matchIndex: number, matchLength: number): string {
  const start = Math.max(0, matchIndex - EVIDENCE_SNIPPET_RADIUS);
  const end = Math.min(text.length, matchIndex + matchLength + EVIDENCE_SNIPPET_RADIUS);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return `${prefix}${text.slice(start, end)}${suffix}`;
}
