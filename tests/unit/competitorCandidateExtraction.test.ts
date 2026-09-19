import { describe, expect, it } from "vitest";
import {
  extractCompetitorCandidates,
  isLikelyClinicNameCandidate,
} from "@/domain/ai-measurement/competitorCandidateExtraction";

/**
 * competitor candidate抽出のunit test(設計書8.1章・F章)。
 * AI回答本文に実際に出現した名称候補のみを抽出し、実在確定はしないことを検証する。
 * MockCompetitorProviderの架空競合リストとは一切関わらない、独立した純粋関数であることも
 * (excludeNamesで自院名を除外できることを通じて)確認する。
 */
describe("extractCompetitorCandidates", () => {
  it("「〜歯科」「〜デンタルクリニック」等のパターンで実際に出現した名称候補を抽出する", () => {
    const result = extractCompetitorCandidates({
      responseText:
        "このエリアでは「あおぞら歯科」や「はなデンタルクリニック」が候補として挙げられます。",
      excludeNames: ["さくら歯科クリニック"],
    });
    expect(result.map((c) => c.name)).toEqual(["あおぞら歯科", "はなデンタルクリニック"]);
  });

  it("excludeNamesに指定した自院名は候補から除外される(自院を競合として抽出しない)", () => {
    const result = extractCompetitorCandidates({
      responseText: "「さくら歯科クリニック」も「あおぞら歯科」も候補です。",
      excludeNames: ["さくら歯科クリニック"],
    });
    expect(result.map((c) => c.name)).toEqual(["あおぞら歯科"]);
  });

  it("同一名称が複数回出現しても1件のみ(最初の出現位置)を返す", () => {
    const result = extractCompetitorCandidates({
      responseText: "「あおぞら歯科」は人気です。「あおぞら歯科」の口コミも良いです。",
      excludeNames: [],
    });
    expect(result.length).toBe(1);
    expect(result[0]!.name).toBe("あおぞら歯科");
  });

  it("抽出順は本文中の出現順になる(rank推定にそのまま使えるようmatchedIndexが昇順)", () => {
    const result = extractCompetitorCandidates({
      responseText: "まず「はな歯科」、次に「みどり歯科医院」が挙げられます。",
      excludeNames: [],
    });
    expect(result.map((c) => c.name)).toEqual(["はな歯科", "みどり歯科医院"]);
    expect(result[0]!.matchedIndex).toBeLessThan(result[1]!.matchedIndex);
  });

  it("候補となる名称パターンが本文に無ければ空配列を返す", () => {
    const result = extractCompetitorCandidates({
      responseText: "特に候補となる医院名は挙げられませんでした。",
      excludeNames: [],
    });
    expect(result).toEqual([]);
  });

  /**
   * 2026-09-07のユーザー指示(fixtureテストで実際に発覚した誤抽出への対応)。
   * 「駅前でおすすめの歯科医院」のような一般的な説明句を、固有名詞の医院名候補と
   * 誤認しないことを検証する。単語blacklistではなく説明句パターンでの判定のため、
   * 「渋谷駅前歯科医院」のような地名入り正式名称は過剰除外されないことも確認する。
   */
  it("説明句(〜でおすすめの/近くの/人気の 等)で終わる候補はgeneric phraseとして除外する", () => {
    const excluded = ["駅前でおすすめの歯科医院", "近くの歯科医院", "人気の歯科クリニック"];
    for (const text of excluded) {
      const result = extractCompetitorCandidates({ responseText: text, excludeNames: [] });
      expect(result, `${text} は除外されるべき`).toEqual([]);
    }
  });

  it("固有名詞らしい医院名候補(地名を含む正式名称を含む)は除外しない", () => {
    const kept = ["みどり歯科医院", "さくら歯科クリニック", "渋谷駅前歯科医院"];
    for (const text of kept) {
      const result = extractCompetitorCandidates({ responseText: text, excludeNames: [] });
      expect(result.map((c) => c.name), `${text} は保持されるべき`).toEqual([text]);
    }
  });

  it("「駅前」という単語そのものではなく、説明句パターン(語尾)で判定するため地名入り正式名称を除外しない", () => {
    // 「駅前」を含むだけで除外される単語blacklist方式になっていないことの確認
    // (「渋谷駅前歯科医院」は保持されるが、「駅前でおすすめの歯科医院」は除外される)。
    const kept = extractCompetitorCandidates({
      responseText: "「渋谷駅前歯科医院」が候補です。",
      excludeNames: [],
    });
    expect(kept.map((c) => c.name)).toEqual(["渋谷駅前歯科医院"]);

    const excluded = extractCompetitorCandidates({
      responseText: "「駅前でおすすめの歯科医院」が候補です。",
      excludeNames: [],
    });
    expect(excluded).toEqual([]);
  });
});

describe("isLikelyClinicNameCandidate", () => {
  it("「の」で終わるname partはgeneric descriptionと判定しfalseを返す", () => {
    expect(isLikelyClinicNameCandidate("駅前でおすすめの")).toBe(false);
    expect(isLikelyClinicNameCandidate("近くの")).toBe(false);
    expect(isLikelyClinicNameCandidate("人気の")).toBe(false);
  });

  it("「やすい」で終わるname partはgeneric descriptionと判定しfalseを返す", () => {
    expect(isLikelyClinicNameCandidate("通いやすい")).toBe(false);
  });

  it("固有名詞らしいname partはtrueを返す(地名を含んでいてもよい)", () => {
    expect(isLikelyClinicNameCandidate("みどり")).toBe(true);
    expect(isLikelyClinicNameCandidate("さくら")).toBe(true);
    expect(isLikelyClinicNameCandidate("渋谷駅前")).toBe(true);
  });

  it("空文字はfalseを返す", () => {
    expect(isLikelyClinicNameCandidate("")).toBe(false);
  });
});
