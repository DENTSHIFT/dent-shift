// 2026-09-24: Instagramプロフィール短縮URL(/ig)の実際の遷移先。
// route.tsから分離しているのは、Next.jsのroute/pageファイルが決められたexportしか
// 許可しないため(named exportを追加するとビルド時型エラーになる)。
export const IG_REDIRECT_TARGET = "/visual?utm_source=instagram&utm_medium=profile&utm_campaign=launch";
