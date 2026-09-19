import { normalizeForMatching } from "./clinicMentionMatching";

/**
 * competitor candidate抽出(設計書8.1章・F章)。
 * AI回答本文に「〜歯科」「〜デンタルクリニック」等のパターンで実際に出現した名称候補のみを
 * 抽出する。実在の近隣競合医院として確定はしない(derived/provisionalなcandidateに留める)。
 * MockCompetitorProviderの架空競合リストとは型・生成関数ともに完全に分離しており、
 * この関数の戻り値をmock競合配列へマージするコードは書かない(2026-09-07のユーザー指示、
 * 設計書8.1章の確定ルール)。
 *
 * 2026-09-07の追加ユーザー指示(fixtureテストで実際に発覚した誤抽出への対応):
 * 「駅前でおすすめの歯科医院」のような一般的な説明句(generic description)を、
 * 固有名詞の医院名候補と誤認しないようにする。抽出処理を以下5段階へ分離する。
 *   1. suffixを持つ文字列候補の抽出(extractRawSuffixCandidates)
 *   2. generic modifier/descriptive phraseの除外(isLikelyClinicNameCandidate)
 *   3. 自院名称・aliasの除外(excludeNames)
 *   4. 重複除外
 *   5. 本文出現順維持
 * 単語のblacklist(「駅前」等の単語そのものを禁止語にする)ではなく、「〜でおすすめの」
 * 「近くの」「人気の」「〜やすい」のような説明句パターンで判定することで、
 * 「渋谷駅前歯科医院」のような地名を含む正式名称まで過剰除外しないようにする。
 */

export interface CompetitorCandidate {
  /** 応答本文から抽出された名称そのもの(架空データではなく、実際にAIが出力した文字列)。 */
  name: string;
  /** 正規化後テキスト内でのマッチ開始位置(言及順によるrank推定に使う)。 */
  matchedIndex: number;
}

/** 歯科医院の名称としてよくある語尾パターン(P0はこの単純な語尾マッチのみ。設計書8.1章)。 */
const CLINIC_NAME_SUFFIX_PATTERN =
  /([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z0-9ー・]{2,20}?)(歯科医院|歯科クリニック|デンタルクリニック|デンタルオフィス|歯科|クリニック)/gu;

/**
 * candidateのうち、suffixより前の部分(name part)がこのパターンで終わっていれば、
 * 「〜の」「〜やすい」のような説明句(descriptive phrase)で構成された一般的な言い回しと
 * みなす(固有名詞ではない)。単語そのもののblacklistではなく、あくまで語尾の文法的
 * パターンで判定するため、「渋谷駅前歯科医院」のような地名入り正式名称は除外されない
 * (name part「渋谷駅前」はこのパターンで終わらない)。
 */
const GENERIC_DESCRIPTIVE_NAME_PART_ENDING_PATTERN = /(?:の|やすい)$/;

/** suffix抽出直後の生candidate(段階1の出力)。 */
export interface RawSuffixCandidate {
  /** name part + suffix(抽出された文字列全体)。 */
  name: string;
  /** suffixより前の部分。generic phrase判定はこの部分のみを見る。 */
  namePart: string;
  /** マッチしたsuffix自体("歯科"「クリニック」等)。 */
  suffix: string;
  matchedIndex: number;
}

/**
 * 段階1: 正規化済みテキストから、suffixパターンを持つ文字列候補を機械的にすべて抽出する
 * (この時点ではgeneric phraseの除外はまだ行わない)。
 */
export function extractRawSuffixCandidates(normalizedText: string): RawSuffixCandidate[] {
  const results: RawSuffixCandidate[] = [];
  for (const match of normalizedText.matchAll(CLINIC_NAME_SUFFIX_PATTERN)) {
    const namePart = match[1] ?? "";
    const suffix = match[2] ?? "";
    results.push({
      name: `${namePart}${suffix}`,
      namePart,
      suffix,
      matchedIndex: match.index ?? 0,
    });
  }
  return results;
}

/**
 * 段階2: candidateのname part(suffixを除いた前半部分)が、説明句だけで構成されている
 * ("〜でおすすめの"「近くの」「人気の」「通いやすい」等)かを判定する純粋predicate。
 * true = 固有名詞らしい医院名候補として残す。false = 一般的な説明句として除外する。
 */
export function isLikelyClinicNameCandidate(namePart: string): boolean {
  if (namePart.length === 0) return false;
  return !GENERIC_DESCRIPTIVE_NAME_PART_ENDING_PATTERN.test(namePart);
}

export interface ExtractCompetitorCandidatesInput {
  responseText: string;
  /** 自院の名称・表記ゆれ候補(抽出結果から除外する。「自院を競合として抽出しない」ため)。 */
  excludeNames: string[];
}

/**
 * 応答本文からcompetitor candidateを抽出する(段階1〜5すべてを適用)。
 * 同一名称は1件のみ(最初の出現位置)を返す。抽出順は本文中の出現順
 * (=rank推定にそのまま使える)。
 */
export function extractCompetitorCandidates(
  input: ExtractCompetitorCandidatesInput
): CompetitorCandidate[] {
  const normalizedExcludeNames = new Set(
    input.excludeNames
      .map((name) => normalizeForMatching(name))
      .filter((name) => name.length > 0)
  );
  const normalizedText = normalizeForMatching(input.responseText);

  // 段階1: suffixを持つ文字列候補の抽出
  const rawCandidates = extractRawSuffixCandidates(normalizedText);

  const seen = new Set<string>();
  const results: CompetitorCandidate[] = [];
  for (const candidate of rawCandidates) {
    // 段階2: generic modifier/descriptive phraseの除外
    if (!isLikelyClinicNameCandidate(candidate.namePart)) continue;
    // 段階3: 自院名称・aliasの除外
    if (normalizedExcludeNames.has(candidate.name)) continue;
    // 段階4: 重複除外
    if (seen.has(candidate.name)) continue;
    seen.add(candidate.name);
    // 段階5: 本文出現順維持(rawCandidatesは元々出現順、フィルタのみで並び替えは行わない)
    results.push({ name: candidate.name, matchedIndex: candidate.matchedIndex });
  }
  return results;
}
