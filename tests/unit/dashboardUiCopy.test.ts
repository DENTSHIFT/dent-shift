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

  // 2026-09-29追加(PO承認): 「相談は任意です。営業電話はありません。」等の表現を、
  // 承認済みの統一文言(3行)へ置き換えた回帰テスト。
  it("スペシャリスト相談の注記が、承認済みの統一文言(CSチーム対応・無理な営業なし)になっている", () => {
    const source = dashboardSource();
    expect(source).toContain("使い方や改善方法のご相談は、オンラインにてCSチームが対応します。");
    expect(source).toContain("弊社から無理な営業は一切いたしません。");
    expect(source).toContain("お気軽にご相談ください。");
    expect(source).not.toContain("相談は任意です。営業電話はありません。");
  });

  // 2026-09-29追加(PO承認): AI集患総合スコアのドーナツ中央表示を「17」から「17点」へ
  // (「点」は数値より小さいサイズで同一行に配置、実際の数値を動的に使用)。
  it("AI集患総合スコアのドーナツ中央に、実際の数値+「点」を動的に表示する(固定値ではない)", () => {
    const source = dashboardSource();
    expect(source).toContain("{vm.result.overall.points}");
    expect(source).toMatch(/\{vm\.result\.overall\.points\}\s*<span className=\{styles\.scoreUnit\}>点<\/span>/);
  });

  // 2026-09-29追加(PO承認): セクション順を「サンプル注意→AI集患総合スコア＋6領域スコア→
  // AI選出率/優先課題数/取得状況→改善タスクと詳細」へ変更した回帰テスト。
  it("overviewGrid(AI集患総合スコア＋6領域スコア)がmetricsGrid(簡易指標)より前に出現する", () => {
    const source = dashboardSource();
    const overviewIndex = source.indexOf('className={styles.overviewGrid}');
    const metricsIndex = source.indexOf('className={styles.metricsGrid}');
    expect(overviewIndex).toBeGreaterThan(-1);
    expect(metricsIndex).toBeGreaterThan(-1);
    expect(overviewIndex).toBeLessThan(metricsIndex);
  });

  it("簡易指標(metricsGrid)から重複する「総合スコア」カードが削除されている(AI選出率が最初のカード)", () => {
    const source = dashboardSource();
    const metricsIndex = source.indexOf('className={styles.metricsGrid}');
    const nextCardMatch = source.slice(metricsIndex).match(/<p className=\{styles\.metricLabel\}>([^<]+)<\/p>/);
    expect(nextCardMatch).not.toBeNull();
    expect(nextCardMatch![1]).toBe("AI選出率");
  });

  it("改善TOP3(今月の優先改善 TOP3)はmetricsGridより後に出現する", () => {
    const source = dashboardSource();
    const metricsIndex = source.indexOf('className={styles.metricsGrid}');
    const improvementsIndex = source.indexOf("今月の優先改善 TOP3");
    expect(improvementsIndex).toBeGreaterThan(metricsIndex);
  });
});

// 2026-09-29追加(PO承認): 診断結果画面の電話問い合わせCTA注記も、
// 「ご不明点があれば〜こちらからの営業電話は一切行いません」から統一文言へ置き換えた回帰テスト。
describe("診断結果画面のお電話問い合わせ注記の正確性", () => {
  function resultPageSource(): string {
    return readFileSync(
      path.join(process.cwd(), "src/app/diagnosis/result/[id]/page.tsx"),
      "utf8"
    );
  }

  it("お電話でのお問い合わせ注記が、承認済みの統一文言(CSチーム対応・無理な営業なし)になっている", () => {
    const source = resultPageSource();
    expect(source).toContain("使い方や改善方法のご相談は、オンラインにてCSチームが対応します。");
    expect(source).toContain("弊社から無理な営業は一切いたしません。");
    expect(source).not.toContain(
      "ご不明点があれば、お気軽にお電話ください。こちらからの営業電話は一切行いません。"
    );
  });

  it("「相談は任意です」の別文脈(診断結果の閲覧・ご利用の条件ではない旨)は意味が異なるため維持する", () => {
    const source = resultPageSource();
    expect(source).toContain("相談は任意です。診断結果の閲覧・ご利用の条件ではありません。");
  });

  // 2026-09-29追加(PO承認): セクション順を「サンプル注意→AI集患総合スコア＋6領域スコア→
  // AI選出率等の要約→改善タスクと詳細」へ変更した回帰テスト(order CSSの値を検証)。
  it("6領域スコア(ds-order-domains)が要約(ds-order-summary)・改善TOP3(ds-order-top3)より前になるorder値である", () => {
    const source = resultPageSource();
    const orderOf = (cls: string): number => {
      const match = source.match(new RegExp(`\\.${cls} \\{ order: (\\d+); \\}`));
      expect(match).not.toBeNull();
      return Number(match![1]);
    };
    expect(orderOf("ds-order-score")).toBeLessThan(orderOf("ds-order-domains"));
    expect(orderOf("ds-order-domains")).toBeLessThan(orderOf("ds-order-summary"));
    expect(orderOf("ds-order-summary")).toBeLessThan(orderOf("ds-order-top3"));
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
