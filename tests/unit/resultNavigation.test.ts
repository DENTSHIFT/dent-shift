import { describe, expect, it } from "vitest";
import { shouldShowDashboardReturnLink } from "@/app/diagnosis/result/[id]/resultNavigation";

describe("shouldShowDashboardReturnLink", () => {
  it("ログイン中の医院と診断結果の医院が一致する場合だけ表示する", () => {
    expect(shouldShowDashboardReturnLink("clinic-1", "clinic-1")).toBe(true);
  });

  it("別医院の診断結果には表示しない", () => {
    expect(shouldShowDashboardReturnLink("clinic-1", "clinic-2")).toBe(false);
  });

  it("未ログインでは表示しない", () => {
    expect(shouldShowDashboardReturnLink(null, "clinic-1")).toBe(false);
    expect(shouldShowDashboardReturnLink(undefined, "clinic-1")).toBe(false);
  });
});
