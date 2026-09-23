import type { CompetitorClinic } from "@/domain/competitor/types";
import type { CompetitorProvider } from "./types";

/**
 * 近隣競合比較の実データ取得基盤が未実装のため、本番では架空の競合医院名
 * (MockCompetitorProviderが生成する「[サンプル]近隣〇〇歯科」等)を一切出さない
 * (2026-09-24のユーザー指示: 疑似データを実測結果のように見せない)。
 * 常に空配列を返し、UI側(diagnosis/result)は0件を「準備中」として表示する。
 * 将来、実際のGBP/検索結果に接続するProviderへこのまま差し替えられるよう、
 * CompetitorProviderインターフェースはそのまま維持する。
 */
export class UnavailableCompetitorProvider implements CompetitorProvider {
  readonly name = "unavailable-competitor-provider";

  async findNearbyCompetitors(): Promise<CompetitorClinic[]> {
    return [];
  }
}
