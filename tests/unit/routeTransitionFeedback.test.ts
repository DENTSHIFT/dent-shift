import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 2026-09-29追加(PO指示): 通常遷移(ログアウト・ダッシュボード/料金/診断結果への
 * サーバー遷移)で、押下直後の視覚的フィードバックが一切無く「1秒以上無反応」に
 * 見える問題の回帰テスト。
 */
describe("LogoutButtonの押下直後フィードバック", () => {
  function logoutButtonSource(): string {
    return readFileSync(
      path.join(process.cwd(), "src/app/dashboard/LogoutButton.tsx"),
      "utf8"
    );
  }

  it("押下直後にdisabled化し、「ログアウトしています…」を表示する", () => {
    const source = logoutButtonSource();
    expect(source).toContain("disabled={loggingOut}");
    expect(source).toContain("ログアウトしています…");
  });

  it("連打防止用のinFlightガードを持つ", () => {
    const source = logoutButtonSource();
    expect(source).toContain("inFlight.current");
    expect(source).toMatch(/if \(inFlight\.current\) return;/);
  });

  it("finally節でローディング状態を必ず解除する(戻る操作等で状態が残り続けない)", () => {
    const source = logoutButtonSource();
    expect(source).toMatch(/finally\s*{[\s\S]*setLoggingOut\(false\)/);
  });
});

describe("サーバー遷移中の共通ローディング表示(Next.js loading.tsx)", () => {
  const targets = [
    "src/app/dashboard/loading.tsx",
    "src/app/plans/loading.tsx",
    "src/app/diagnosis/result/[id]/loading.tsx",
  ];

  it.each(targets)("%s が存在し、共通コンポーネントRouteLoadingIndicatorを使う", (relativePath) => {
    const filePath = path.join(process.cwd(), relativePath);
    expect(existsSync(filePath)).toBe(true);
    const source = readFileSync(filePath, "utf8");
    expect(source).toContain("RouteLoadingIndicator");
  });

  it("共通コンポーネント自体は大規模なスケルトンUIではなく、最小限のスピナー+テキストのみで構成される", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/components/RouteLoadingIndicator.tsx"),
      "utf8"
    );
    expect(source).toContain("読み込んでいます…");
    expect(source).toContain('role="status"');
  });
});
