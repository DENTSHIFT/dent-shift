import { describe, expect, it } from "vitest";
import { convertOpenAiResponseToObservation } from "@/server/providers/ai/openai/openAiAdapter";
import { validateAiMeasurementObservation } from "@/domain/ai-measurement/invariants";
import type { OpenAiFetchOutcome } from "@/server/providers/ai/openai/openAiResponseTypes";

import case1Fixture from "../fixtures/openai/case1-mention-with-citations-and-competitor.json";
import case2Fixture from "../fixtures/openai/case2-search-no-mention.json";
import case3Fixture from "../fixtures/openai/case3-no-search-executed.json";
import case4Fixture from "../fixtures/openai/case4-provider-error.json";
import case5Fixture from "../fixtures/openai/case5-rank-from-mention-order.json";

/**
 * OpenAI fixture → canonical AiMeasurementObservation変換のfixtureベースunit test
 * (2026-09-07のユーザー指示)。実ネットワーク呼び出しは一切行わない。
 * ここで検証する5ケースは、ユーザー指示の「fixtureで必ず検証するケース」1〜5に対応する。
 */

const CLINIC_NAME = "さくら歯科クリニック";
const OFFICIAL_URL = "https://sakura-dental-clinic.example.com";
const CAPTURED_AT = "2026-01-01T00:00:00.000Z";

function convert(outcome: OpenAiFetchOutcome, question: string) {
  return convertOpenAiResponseToObservation({
    question,
    clinicName: CLINIC_NAME,
    officialClinicUrl: OFFICIAL_URL,
    region: null,
    outcome,
    capturedAt: CAPTURED_AT,
  });
}

describe("convertOpenAiResponseToObservation: ケース1(web search実行あり・mentionあり・citationsあり・competitor候補あり)", () => {
  const observation = convert(case1Fixture as OpenAiFetchOutcome, "駅から近いおすすめの歯医者は?");

  it("domain invariantを満たす(adapter自身が自己検証済み)", () => {
    expect(() => validateAiMeasurementObservation(observation)).not.toThrow();
  });

  it("web_search_callが存在するためmeasurementStatus='measured'になる(sourceType='ai_provider'・measurementMeta必須)", () => {
    expect(observation.measurementStatus).toBe("measured");
    expect(observation.sourceType).toBe("ai_provider");
    expect(observation.measurementMeta).not.toBeNull();
    expect(observation.measurementMeta!.searchExecuted).toBe(true);
    expect(observation.measurementMeta!.searchQueries).toEqual(["駅前 おすすめ 歯科医院"]);
  });

  it("measurementStatus='measured'のためobservation単位のprovisionalはfalseになる(2026-09-07のユーザー指示で確定)", () => {
    expect(observation.provisional).toBe(false);
  });

  it("自院名が本文に出現するためmentioned=trueになる", () => {
    expect(observation.mentioned).toBe(true);
  });

  it("citationsに応答内のURLがすべて含まれる(citationが存在する事実)", () => {
    expect(observation.citations).toHaveLength(2);
    expect(observation.citations).toContain("https://www.sakura-dental-clinic.example.com/");
  });

  it("自院公式ドメインのcitationが含まれることがevidenceに反映される(citation存在と公式ドメイン一致は別軸)", () => {
    expect(observation.evidence).toContain("自院公式ドメインがcitationされています");
  });

  it("本文に出現した競合候補(みどり歯科医院)がcompetitorMentionsに含まれる(mockとは無関係)", () => {
    expect(observation.competitorMentions).toEqual(["みどり歯科医院"]);
  });

  it("自院が競合より先に本文へ出現するためrecommendationRank=1になる", () => {
    expect(observation.recommendationRank).toBe(1);
  });

  it("fieldProvenanceがユーザー指示の原則どおりになる(mentioned=derived, rank=estimated, citations=direct, competitors=derived)", () => {
    const fp = observation.measurementMeta!.fieldProvenance;
    expect(fp.mentioned).toEqual({ measurementStatus: "measured", derivation: "derived" });
    expect(fp.recommendationRank).toEqual({ measurementStatus: "measured", derivation: "estimated" });
    expect(fp.citations).toEqual({ measurementStatus: "measured", derivation: "direct" });
    expect(fp.competitorMentions).toEqual({ measurementStatus: "measured", derivation: "derived" });
  });
});

describe("convertOpenAiResponseToObservation: ケース2(web search実行あり・mentionなし・citations空配列)", () => {
  const observation = convert(case2Fixture as OpenAiFetchOutcome, "土日も診療している歯科医院は?");

  it("domain invariantを満たす", () => {
    expect(() => validateAiMeasurementObservation(observation)).not.toThrow();
  });

  it("measurementStatus='measured'のままmentioned=falseになる(未言及と未測定を混同しない)", () => {
    expect(observation.measurementStatus).toBe("measured");
    expect(observation.mentioned).toBe(false);
    expect(observation.recommendationRank).toBeNull();
  });

  it("measurementStatus='measured'のためobservation単位のprovisionalはfalseになる", () => {
    expect(observation.provisional).toBe(false);
  });

  it("citationsは0件(未測定nullではなく空配列)になる", () => {
    expect(observation.citations).toEqual([]);
  });

  it("本文中の他院候補がcompetitorMentionsとして抽出される", () => {
    expect(observation.competitorMentions).toEqual(["あおぞら歯科", "はなデンタルクリニック"]);
  });
});

describe("convertOpenAiResponseToObservation: ケース3(APIレスポンスはあるがweb searchが実行されていない)", () => {
  const observation = convert(case3Fixture as OpenAiFetchOutcome, "インプラント対応の歯科医院は?");

  it("domain invariantを満たす", () => {
    expect(() => validateAiMeasurementObservation(observation)).not.toThrow();
  });

  it("web_search_callが無いためmeasurementStatus='reference'になり、'measured'扱いにしない", () => {
    expect(observation.measurementMeta!.searchExecuted).toBe(false);
    expect(observation.measurementStatus).toBe("reference");
    expect(observation.measurementStatus).not.toBe("measured");
    expect(observation.sourceType).toBe("ai_provider"); // mockではなくai_provider経由であることは変わらない
  });

  it("measurementStatus='reference'のためobservation単位のprovisionalはtrueになる(2026-09-07のユーザー指示で確定)", () => {
    expect(observation.provisional).toBe(true);
  });

  it("fieldProvenanceのmeasurementStatusも'reference'になる(観測全体のmeasurementStatusを反映)", () => {
    const fp = observation.measurementMeta!.fieldProvenance;
    expect(fp.mentioned.measurementStatus).toBe("reference");
    expect(fp.recommendationRank.measurementStatus).toBe("reference");
  });

  it("検索なし応答であることがevidenceに明記される", () => {
    expect(observation.evidence).toContain("web検索は実行されませんでした");
  });
});

describe("convertOpenAiResponseToObservation: ケース4(provider timeout/error)", () => {
  const observation = convert(case4Fixture as OpenAiFetchOutcome, "訪問診療に対応していますか?");

  it("domain invariantを満たす", () => {
    expect(() => validateAiMeasurementObservation(observation)).not.toThrow();
  });

  it("measurementStatus='unavailable'になり、mentioned/rank/citations/competitorsがすべてnullになる", () => {
    expect(observation.measurementStatus).toBe("unavailable");
    expect(observation.mentioned).toBeNull();
    expect(observation.recommendationRank).toBeNull();
    expect(observation.citations).toBeNull();
    expect(observation.competitorMentions).toBeNull();
  });

  it("unavailableReasonが設定される(タイムアウトはtemporarily_unavailableへマッピングされる。必須項目)", () => {
    expect(observation.unavailableReason).not.toBeNull();
    expect(observation.unavailableReason).toBe("temporarily_unavailable");
  });

  it("measurementStatus='unavailable'のためobservation単位のprovisionalはfalseになる", () => {
    expect(observation.provisional).toBe(false);
  });

  it("measurementMetaは存在するが、検索は実行されていない扱いになる", () => {
    expect(observation.measurementMeta).not.toBeNull();
    expect(observation.measurementMeta!.searchExecuted).toBe(false);
    expect(observation.measurementMeta!.fieldProvenance.mentioned).toEqual({
      measurementStatus: "unavailable",
      derivation: null,
    });
  });
});

describe("convertOpenAiResponseToObservation: ケース5(本文内言及順によるrank推定)", () => {
  const observation = convert(case5Fixture as OpenAiFetchOutcome, "駅前でランキング上位の歯科医院は?");

  it("domain invariantを満たす", () => {
    expect(() => validateAiMeasurementObservation(observation)).not.toThrow();
  });

  it("競合(はな歯科)が自院より先に本文へ出現するため、rank=2(検索順位ではなく言及順)になる", () => {
    expect(observation.mentioned).toBe(true);
    expect(observation.recommendationRank).toBe(2);
  });

  it("rankのfieldProvenanceは常にderivation='estimated'(観測全体がmeasuredでも推定順位)", () => {
    expect(observation.measurementMeta!.fieldProvenance.recommendationRank.derivation).toBe(
      "estimated"
    );
  });

  it("観測全体はmeasuredのためobservation単位のprovisionalはfalse(「実測だがrankだけ推定」をfieldProvenanceで表現する)", () => {
    expect(observation.measurementStatus).toBe("measured");
    expect(observation.provisional).toBe(false);
  });
});
