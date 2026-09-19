import { describe, expect, it } from "vitest";
import {
  MEASUREMENT_PLAN,
  MEASUREMENT_PLAN_VERSION,
  MeasurementPlanQuestionNotFoundError,
  MeasurementPlanSanityError,
  findMeasurementPlanEntry,
  validateMeasurementPlan,
} from "@/domain/ai-measurement/measurementPlan";
import type { MeasurementPlan } from "@/domain/ai-measurement/measurementPlan";

/**
 * MeasurementPlanのsanity invariant(2026-09-07のユーザー指示)のunit test。
 * DB/ネットワークには一切触れない純粋なテスト。
 */

function basePlan(): MeasurementPlan {
  return {
    planVersion: "test-plan@2026-01-01.1",
    questions: [
      { question: "質問A", targetProviders: ["openai"] },
      { question: "質問B", targetProviders: ["openai", "gemini"] },
    ],
  };
}

describe("MEASUREMENT_PLAN(P0初期内容): 定数自体がsanity validationを満たす", () => {
  it("MEASUREMENT_PLANはvalidateMeasurementPlan()で例外を投げない", () => {
    expect(() => validateMeasurementPlan(MEASUREMENT_PLAN)).not.toThrow();
  });

  it("MEASUREMENT_PLAN.planVersionはMEASUREMENT_PLAN_VERSIONと一致する", () => {
    expect(MEASUREMENT_PLAN.planVersion).toBe(MEASUREMENT_PLAN_VERSION);
  });

  it("MEASUREMENT_PLAN_VERSIONは空文字ではない", () => {
    expect(MEASUREMENT_PLAN_VERSION.trim().length).toBeGreaterThan(0);
  });

  it("2026-09-07のユーザー指示: targetProviders構成変更(6問すべて→3問のみOpenAI対象)に伴い、MEASUREMENT_PLAN_VERSIONは.2である", () => {
    expect(MEASUREMENT_PLAN_VERSION).toBe("ai-measurement-plan@2026-09-07.2");
  });

  it("MEASUREMENT_PLANは重複しない質問を1件以上持つ", () => {
    const questions = MEASUREMENT_PLAN.questions.map((q) => q.question);
    expect(questions.length).toBeGreaterThan(0);
    expect(new Set(questions).size).toBe(questions.length);
  });

  it("2026-09-07のユーザー指示: P0初期内容は6問中3問(駅から近い/土日診療/評判)のみtargetProviders=['openai']で、残り3問はtargetProviders=[](実測対象外)", () => {
    const targeted = MEASUREMENT_PLAN.questions.filter((q) => q.targetProviders.length > 0);
    const untargeted = MEASUREMENT_PLAN.questions.filter((q) => q.targetProviders.length === 0);

    expect(MEASUREMENT_PLAN.questions.length).toBe(6);
    expect(targeted.length).toBe(3);
    expect(untargeted.length).toBe(3);
    expect(targeted.every((q) => q.targetProviders.length === 1 && q.targetProviders[0] === "openai")).toBe(
      true
    );
    expect(new Set(targeted.map((q) => q.question))).toEqual(
      new Set([
        "駅から近いおすすめの歯医者は?",
        "土日も診療している歯科医院は?",
        "評判の良い歯科医院を教えて",
      ])
    );

    // provider能力(6問すべて対応可能)とmeasurement plan(今回の実測対象)は別概念であり、
    // targetProviders=[]の質問がMEASUREMENT_PLANから消えている(=providerが処理できない)
    // わけではないことを確認する(質問一覧そのものは6件のまま維持される)。
    expect(untargeted.map((q) => q.question).sort()).toEqual(
      [
        "痛みが少ないインプラント治療ができる歯科医院は?",
        "子供を連れて行きやすい小児歯科は?",
        "ホワイトニングの料金が分かりやすい歯科医院は?",
      ].sort()
    );
  });
});

describe("validateMeasurementPlan: 正常系", () => {
  it("question重複なし・targetProviders重複なし・既知providerのみの正常なplanは例外を投げない", () => {
    expect(() => validateMeasurementPlan(basePlan())).not.toThrow();
  });

  it("targetProviders=[](未計測の質問)は正当な状態として許可される", () => {
    const plan: MeasurementPlan = {
      planVersion: "test-plan@2026-01-01.1",
      questions: [{ question: "未計測の質問", targetProviders: [] }],
    };
    expect(() => validateMeasurementPlan(plan)).not.toThrow();
  });
});

describe("findMeasurementPlanEntry: plan entry欠落の扱い(2026-09-07のユーザー指示、measurementCoverage加算的接続ラウンド)", () => {
  it("questionに対応するentryが存在すれば、そのentryを返す", () => {
    const plan = basePlan();
    const entry = findMeasurementPlanEntry(plan, "質問A");
    expect(entry).toEqual({ question: "質問A", targetProviders: ["openai"] });
  });

  it("MEASUREMENT_PLANに実在する質問はすべてfindMeasurementPlanEntry()で見つかる(silent nullにならない)", () => {
    for (const entry of MEASUREMENT_PLAN.questions) {
      expect(() => findMeasurementPlanEntry(MEASUREMENT_PLAN, entry.question)).not.toThrow();
    }
  });

  it("questionに対応するentryが存在しない場合、silent nullにせずMeasurementPlanQuestionNotFoundErrorをthrowする(plan/質問定義のdrift検出)", () => {
    const plan = basePlan();
    expect(() => findMeasurementPlanEntry(plan, "planに存在しない質問")).toThrow(
      MeasurementPlanQuestionNotFoundError
    );
  });
});

describe("validateMeasurementPlan: 異常系", () => {
  it("question重複があればMeasurementPlanSanityError", () => {
    const plan = basePlan();
    plan.questions.push({ question: "質問A", targetProviders: [] });
    expect(() => validateMeasurementPlan(plan)).toThrow(MeasurementPlanSanityError);
  });

  it("同一質問内でtargetProvidersが重複していればMeasurementPlanSanityError", () => {
    const plan: MeasurementPlan = {
      planVersion: "test-plan@2026-01-01.1",
      questions: [{ question: "質問A", targetProviders: ["openai", "openai"] }],
    };
    expect(() => validateMeasurementPlan(plan)).toThrow(MeasurementPlanSanityError);
  });

  it("AiProviderId以外のproviderが含まれていればMeasurementPlanSanityError", () => {
    const plan: MeasurementPlan = {
      planVersion: "test-plan@2026-01-01.1",
      questions: [
        {
          question: "質問A",
          // 実行時の不正値混入を模す(型としては許容しないため意図的にキャストする)
          targetProviders: ["chatgpt" as unknown as "openai"],
        },
      ],
    };
    expect(() => validateMeasurementPlan(plan)).toThrow(MeasurementPlanSanityError);
  });

  it("planVersionが空文字(または空白のみ)ならMeasurementPlanSanityError", () => {
    const plan: MeasurementPlan = { ...basePlan(), planVersion: "" };
    expect(() => validateMeasurementPlan(plan)).toThrow(MeasurementPlanSanityError);

    const whitespaceOnly: MeasurementPlan = { ...basePlan(), planVersion: "   " };
    expect(() => validateMeasurementPlan(whitespaceOnly)).toThrow(MeasurementPlanSanityError);
  });
});
