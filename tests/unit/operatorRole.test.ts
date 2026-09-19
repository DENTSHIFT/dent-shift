import { describe, expect, it } from "vitest";
import { isOperatorRole } from "@/domain/ops/operatorRole";

describe("isOperatorRole", () => {
  it("SECURITY.mdで定義された4ロールを許可する", () => {
    expect(isOperatorRole("admin")).toBe(true);
    expect(isOperatorRole("cs")).toBe(true);
    expect(isOperatorRole("analyst")).toBe(true);
    expect(isOperatorRole("finance")).toBe(true);
  });

  it("医院側ロール(owner等)は運営側ロールとして扱わない", () => {
    expect(isOperatorRole("owner")).toBe(false);
    expect(isOperatorRole("staff")).toBe(false);
  });
});
