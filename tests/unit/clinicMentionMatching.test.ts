import { describe, expect, it } from "vitest";
import { matchClinicMention, normalizeForMatching } from "@/domain/ai-measurement/clinicMentionMatching";

/**
 * clinic mention判定のunit test(設計書7章・G章)。
 * 「単純なincludesだけで確定しない」という指示どおり、正式名称/表記ゆれ(alias)と、
 * citationの自院公式ドメイン一致とを、別々の事実として検証する。
 */
describe("matchClinicMention", () => {
  const officialClinicUrl = "https://sakura-dental-clinic.example.com";

  it("正式名称が本文にそのまま出現すればmentioned=trueになる", () => {
    const result = matchClinicMention({
      responseText: "駅前でおすすめなのは「さくら歯科クリニック」です。",
      clinicName: "さくら歯科クリニック",
      officialClinicUrl,
      citations: [],
    });
    expect(result.mentioned).toBe(true);
    expect(result.matchedNameVariant).toBe("さくら歯科クリニック");
    expect(result.matchedIndex).not.toBeNull();
  });

  it("正式名称は出現しないがaliasが出現すればmentioned=trueになる(表記ゆれ対応)", () => {
    const result = matchClinicMention({
      responseText: "このエリアなら「さくらデンタル」が候補です。",
      clinicName: "さくら歯科クリニック",
      clinicNameAliases: ["さくらデンタル"],
      officialClinicUrl,
      citations: [],
    });
    expect(result.mentioned).toBe(true);
    expect(result.matchedNameVariant).toBe("さくらデンタル");
  });

  it("名称もaliasも本文に出現しなければmentioned=falseになる", () => {
    const result = matchClinicMention({
      responseText: "このエリアなら「あおぞら歯科」が候補です。",
      clinicName: "さくら歯科クリニック",
      officialClinicUrl,
      citations: [],
    });
    expect(result.mentioned).toBe(false);
    expect(result.matchedNameVariant).toBeNull();
    expect(result.matchedIndex).toBeNull();
    expect(result.evidenceSnippet).toBeNull();
  });

  it("全角英数・全角スペースを正規化してマッチできる", () => {
    expect(normalizeForMatching("ＡＢＣ　ｄｅｆ")).toBe("ABC def");
  });

  it("citationsに自院公式ドメインが含まれればofficialDomainCited=trueになる(mention判定とは独立)", () => {
    const result = matchClinicMention({
      responseText: "「あおぞら歯科」が候補です。",
      clinicName: "さくら歯科クリニック",
      officialClinicUrl,
      citations: ["https://www.sakura-dental-clinic.example.com/"],
    });
    // 本文には自院名が出現していないためmentioned=falseだが、citationは自院公式ドメイン
    // (=「citationが存在する」ことと「自院公式サイトがcitationされた」ことは別軸)。
    expect(result.mentioned).toBe(false);
    expect(result.officialDomainCited).toBe(true);
    expect(result.matchedCitationUrl).toBe("https://www.sakura-dental-clinic.example.com/");
  });

  it("citationsが存在しても自院公式ドメインと一致しなければofficialDomainCited=falseになる", () => {
    const result = matchClinicMention({
      responseText: "「さくら歯科クリニック」が候補です。",
      clinicName: "さくら歯科クリニック",
      officialClinicUrl,
      citations: ["https://midori-shika.example.com/"],
    });
    expect(result.mentioned).toBe(true);
    expect(result.officialDomainCited).toBe(false);
    expect(result.matchedCitationUrl).toBeNull();
  });
});
