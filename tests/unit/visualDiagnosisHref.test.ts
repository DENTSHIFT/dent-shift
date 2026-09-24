import { describe, expect, it } from "vitest";
import { buildDiagnosisHref } from "@/app/visual/buildDiagnosisHref";

/**
 * 2026-09-24: /visualへの流入UTM(5項目)が、CTAの遷移先(/diagnosis)へ引き継がれることを
 * 確認する。Instagram等のチャネル別に診断開始・完了を比較するための前提条件。
 */
describe("buildDiagnosisHref", () => {
  it("UTM5項目がすべて揃っている場合はクエリとして引き継ぐ", () => {
    expect(
      buildDiagnosisHref({
        utm_source: "instagram",
        utm_medium: "profile",
        utm_campaign: "launch",
        utm_content: "bio-link",
        utm_term: "ai-diagnosis",
      })
    ).toBe(
      "/diagnosis?utm_source=instagram&utm_medium=profile&utm_campaign=launch&utm_content=bio-link&utm_term=ai-diagnosis"
    );
  });

  it("UTMが無い場合はクエリ無しの/diagnosisを返す", () => {
    expect(buildDiagnosisHref({})).toBe("/diagnosis");
  });

  it("一部のUTMのみ指定された場合は指定分だけ引き継ぐ", () => {
    expect(buildDiagnosisHref({ utm_source: "instagram" })).toBe("/diagnosis?utm_source=instagram");
  });

  it("UTM以外の無関係なクエリパラメータは引き継がない", () => {
    expect(buildDiagnosisHref({ utm_source: "instagram", other_param: "x" })).toBe(
      "/diagnosis?utm_source=instagram"
    );
  });

  it("値が配列(重複クエリ)の場合は先頭の値だけを使う", () => {
    expect(buildDiagnosisHref({ utm_source: ["instagram", "duplicate"] })).toBe(
      "/diagnosis?utm_source=instagram"
    );
  });
});
