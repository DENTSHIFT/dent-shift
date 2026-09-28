import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import NotFound from "@/app/not-found";

/**
 * 2026-09-29追加(PO指示): 存在しないURLへアクセスした際にNext.js既定の
 * 素の404ページ(戻る手段が無い行き止まり)が表示されていた問題の回帰テスト。
 * src/app/not-found.tsxは認証状態を判定しない(判定ロジックは/dashboard側の
 * requireContactへ委ねる)ため、ここでは追加のモックなしにレンダリングできる。
 */
describe("NotFound(存在しないページの行き止まり解消)", () => {
  function render(): string {
    return renderToStaticMarkup(createElement(NotFound));
  }

  it("日本語で「ページが見つかりません」と説明する", () => {
    const html = render();
    expect(html).toContain("ページが見つかりません");
  });

  it("「トップページへ戻る」を表示し、/へリンクする", () => {
    const html = render();
    expect(html).toContain("トップページへ戻る");
    expect(html).toMatch(/href="\/"[^>]*>\s*トップページへ戻る|トップページへ戻る[\s\S]{0,0}/);
    const topLinkMatch = html.match(/<a[^>]*href="\/"[^>]*>([^<]*)<\/a>/);
    expect(topLinkMatch).not.toBeNull();
    expect(topLinkMatch![1]).toContain("トップページへ戻る");
  });

  it("「ダッシュボードへ移動」を表示し、/dashboardへリンクする(未ログイン時の判定は既存のrequireContactに委ねる)", () => {
    const html = render();
    const dashboardLinkMatch = html.match(/<a[^>]*href="\/dashboard"[^>]*>([^<]*)<\/a>/);
    expect(dashboardLinkMatch).not.toBeNull();
    expect(dashboardLinkMatch![1]).toContain("ダッシュボードへ移動");
  });
});
