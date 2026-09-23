import type { RawAdRiskFinding } from "@/domain/ad-compliance/types";
import type { AdComplianceProvider } from "./types";

/**
 * 医療広告AIチェックの実データ取得基盤が未実装のため、本番ではダミーの
 * 「高リスク検出」等を一切出さない(2026-09-24のユーザー指示: 根拠なく医院にリスクが
 * あるように見える表示を出さない)。常に空配列を返し、UI側(diagnosis/result)は
 * 0件を「準備中」として表示する。将来、実際のページ本文取得・LLM分類に接続する
 * Providerへこのまま差し替えられるよう、AdComplianceProviderインターフェースは
 * そのまま維持する。
 */
export class UnavailableAdComplianceProvider implements AdComplianceProvider {
  readonly name = "unavailable-ad-compliance-provider";

  async check(): Promise<RawAdRiskFinding[]> {
    return [];
  }
}
