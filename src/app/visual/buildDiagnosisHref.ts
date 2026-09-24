import { UTM_PARAM_KEYS } from "@/domain/marketing/utmAttribution";

// 2026-09-24: /visualへの流入時のUTM(5項目)を、/diagnosisへのCTA遷移後も保持する
// (Instagram等のチャネル別に診断「開始」「完了」を比較するため)。
// page.tsxから分離しているのは、Next.jsのpageファイルがdefault/metadata等の
// 決められたexportしか許可しないため(named exportを追加するとビルド時型エラーになる)。
export function buildDiagnosisHref(searchParams: Record<string, string | string[] | undefined>): string {
  const params = new URLSearchParams();
  for (const key of UTM_PARAM_KEYS) {
    const value = searchParams[key];
    const first = Array.isArray(value) ? value[0] : value;
    if (first) params.set(key, first);
  }
  const query = params.toString();
  return query ? `/diagnosis?${query}` : "/diagnosis";
}
