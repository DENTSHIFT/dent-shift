// 2026-09-27追加: ダッシュボードのサイドメニュー/モバイルメニューの
// ハッシュリンク(#ai-search等)は、対応するセクションが実際にDOMへ
// 描画されている場合にのみ有効(そうでないとクリックしてもURLの
// ハッシュだけが変わり画面上は何も起きない)。
// 診断結果がない医院ではこれらのセクションが存在しないため、
// /diagnosisへ案内するリンクへ差し替える。
export const DIAGNOSIS_ONLY_SECTION_IDS = new Set([
  "ai-search",
  "competitors",
  "improvements",
  "history",
]);

export const LOCKED_DIAGNOSIS_HREF = "/diagnosis?locked=1";

/**
 * ダッシュボードのナビゲーション項目のhrefを、実際に画面へ存在するセクションID一覧
 * (availableSectionIds)と照らして解決する。
 * - "#"始まりでない(通常ページ遷移)はそのまま返す。
 * - "#subscription"等、診断の有無に関わらず常に存在するセクションはそのまま返す。
 * - 診断結果がないと存在しないセクション(#ai-search等)は、availableSectionIdsに
 *   含まれていればそのまま、含まれていなければ診断導線(LOCKED_DIAGNOSIS_HREF)を返す。
 */
export function resolveNavHref(href: string, availableSectionIds: ReadonlySet<string>): string {
  if (!href.startsWith("#")) return href;
  const id = href.slice(1);
  if (!DIAGNOSIS_ONLY_SECTION_IDS.has(id)) return href;
  return availableSectionIds.has(id) ? href : LOCKED_DIAGNOSIS_HREF;
}
