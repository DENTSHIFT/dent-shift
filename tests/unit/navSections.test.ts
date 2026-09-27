import { describe, expect, it } from "vitest";
import { LOCKED_DIAGNOSIS_HREF, resolveNavHref } from "@/app/dashboard/navSections";

describe("resolveNavHref", () => {
  it("#で始まらない通常のページ遷移はそのまま返す", () => {
    expect(resolveNavHref("/dashboard", new Set())).toBe("/dashboard");
    expect(resolveNavHref("/onboarding", new Set())).toBe("/onboarding");
    expect(resolveNavHref("/plans", new Set())).toBe("/plans");
  });

  it("#subscriptionは診断の有無に関わらず常にそのまま返す", () => {
    expect(resolveNavHref("#subscription", new Set())).toBe("#subscription");
    expect(resolveNavHref("#subscription", new Set(["ai-search"]))).toBe("#subscription");
  });

  it("診断結果がある(セクションが存在する)場合はハッシュリンクをそのまま返す", () => {
    const available = new Set(["ai-search", "competitors", "improvements", "history", "subscription"]);
    expect(resolveNavHref("#ai-search", available)).toBe("#ai-search");
    expect(resolveNavHref("#competitors", available)).toBe("#competitors");
    expect(resolveNavHref("#improvements", available)).toBe("#improvements");
    expect(resolveNavHref("#history", available)).toBe("#history");
  });

  it("診断結果がなく対応セクションが存在しない場合は診断導線へ差し替える", () => {
    const available = new Set(["subscription"]);
    expect(resolveNavHref("#ai-search", available)).toBe(LOCKED_DIAGNOSIS_HREF);
    expect(resolveNavHref("#competitors", available)).toBe(LOCKED_DIAGNOSIS_HREF);
    expect(resolveNavHref("#improvements", available)).toBe(LOCKED_DIAGNOSIS_HREF);
    expect(resolveNavHref("#history", available)).toBe(LOCKED_DIAGNOSIS_HREF);
  });

  it("httpsアドバイザリにより#improvementsだけ存在する場合は改善アクションのみ有効", () => {
    const available = new Set(["improvements", "subscription"]);
    expect(resolveNavHref("#improvements", available)).toBe("#improvements");
    expect(resolveNavHref("#ai-search", available)).toBe(LOCKED_DIAGNOSIS_HREF);
    expect(resolveNavHref("#history", available)).toBe(LOCKED_DIAGNOSIS_HREF);
  });
});
