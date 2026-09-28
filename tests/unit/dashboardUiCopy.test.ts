import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 2026-09-28追加(PO再指摘): ダッシュボードの実機確認で見つかった2件の正確性問題の
 * 回帰テスト。
 * 1. 「診断すると、6領域のスコア…今月の優先改善が表示されます」という断定
 *    (実際は測定根拠が不足すれば未測定/データ不足になり、必ず表示されるとは限らない)
 * 2. 未実装の競合医院比較を「診断完了後に利用できる」実装済み機能のように
 *    サイドメニューへ表示していた問題
 */
describe("ダッシュボードの正確性(未診断カードの文言・競合医院メニュー)", () => {
  function dashboardSource(): string {
    return readFileSync(path.join(process.cwd(), "src/app/dashboard/page.tsx"), "utf8");
  }

  it("未診断カードは、6領域スコア・優先改善が必ず表示されるとは断定しない", () => {
    const source = dashboardSource();
    expect(source).not.toContain(
      "診断すると、6領域のスコアと患者質問ごとのAI表示状況、今月の優先改善がここに表示されます。"
    );
    // 「診断すると」に続けて「表示されます」等、必ず出るかのような直接的な言い切りを禁止する。
    expect(source).not.toMatch(/診断すると、?6領域のスコア[^」]*表示されます/);
    // 現在実装済みの「患者質問ごとのAI表示状況」の案内自体は引き続き残す。
    expect(source).toContain(
      "無料診断では、実際に取得できた範囲で患者質問ごとのAI表示状況を確認できます。測定根拠が不足する項目は「未測定」と表示します。"
    );
  });

  it("サイドメニュー(NAV_ITEMS)に「競合医院」を含めない(未実装機能を診断後に利用可能なメニューとして見せない)", () => {
    const source = dashboardSource();
    const navItemsMatch = source.match(/const NAV_ITEMS = \[([\s\S]*?)\] as const;/);
    expect(navItemsMatch).not.toBeNull();
    const navItemsBlock = navItemsMatch![1];
    expect(navItemsBlock).not.toContain("競合医院");
    expect(navItemsBlock).not.toContain("#competitors");
  });

  it("モバイルナビにも「競合医院」を含めない", () => {
    const source = dashboardSource();
    const mobileNavMatch = source.match(
      /<nav className=\{styles\.mobileNav\}[\s\S]*?<\/nav>/
    );
    expect(mobileNavMatch).not.toBeNull();
    expect(mobileNavMatch![0]).not.toContain("競合医院");
    expect(mobileNavMatch![0]).not.toContain("#competitors");
  });

  it("競合医院候補セクション自体は残るが、準備中である旨を明示し、リンク・ボタンとして操作可能に見せない", () => {
    const source = dashboardSource();
    expect(source).toContain("近隣競合との比較機能は準備中です");
    expect(source).toContain("近隣競合比較は現在準備中です。対応が完了次第、こちらに反映されます。");
    // セクション見出し自体が診断完了後に「利用できる」実装済み機能であるかのような
    // 案内(title/aria-label)を持たないこと。
    expect(source).not.toMatch(/id="competitors"[\s\S]{0,400}?診断完了後に利用できます/);
  });

  it("既存の診断完了後ロック表示(AI検索・改善アクション・診断履歴)は引き続き正しく案内される(競合医院削除の巻き添えでロック機構自体を壊していない)", () => {
    const source = dashboardSource();
    expect(source).toContain("この機能は無料AI集患診断の完了後に利用できます");
    expect(source).toContain('href: "#ai-search"');
    expect(source).toContain('href: "#improvements"');
  });

  // 2026-09-29追加(PO指示): 本番実機で「AI検索」「競合医院」のクリックが無反応と
  // なっていた不具合の回帰テスト。原因はNext.jsのLinkコンポーネントが同一ページ内の
  // ハッシュ遷移でURLハッシュ更新・スクロールを行わないことだったため、同一ページ内
  // アンカーは素の<a>タグでレンダリングするよう修正した(実機確認済み)。
  it("同一ページ内アンカー(#で始まるhref)はLinkではなくネイティブの<a>タグでレンダリングする分岐を持つ", () => {
    const source = dashboardSource();
    expect(source).toContain("isSamePageAnchor");
    expect(source).toContain("href.startsWith(\"#\")");
    // デスクトップ・モバイル双方のナビで、同一ページ内アンカー用の<a key=...>分岐が
    // 存在すること(Linkコンポーネントへの巻き戻りを防ぐ)。
    const anchorBranchMatches = source.match(/<a key=\{?item\.(label|id)\}? href=\{href\}/g);
    expect(anchorBranchMatches?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("契約セクションへのモバイル固定リンク(#subscription)もLinkではなくネイティブの<a>タグである", () => {
    const source = dashboardSource();
    expect(source).toContain('<a href="#subscription">');
    expect(source).not.toContain('<Link href="#subscription">');
  });
});

describe("オンボーディング導線の正確性", () => {
  it("最初の診断ステップの説明が、6領域の現在地を必ず確認できるとは断定しない", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/app/onboarding/onboardingViewModel.ts"),
      "utf8"
    );
    expect(source).not.toContain("6領域の現在地と、優先して改善する内容を確認します。");
  });
});
