import type { RawAdRiskFinding } from "@/domain/ad-compliance/types";

export interface AdComplianceCheckInput {
  clinicName: string;
  clinicUrl: string;
  /** 口コミ返信文(取得できる範囲。P0では空配列のことが多い) */
  reviewResponseTexts?: string[];
}

/**
 * 医療広告AIチェックの生所見を返すプロバイダーインターフェース。
 * 「取得データ → パターン検出 → RawAdRiskFinding」の変換はすべてこの層の実装が担う。
 * P0はMockAdComplianceProviderのみ。将来、実際のページ本文取得・LLM分類に差し替える場合も、
 * この同じインターフェースの別実装として追加し、domain層(ad-compliance/*)や
 * サービス層(runFreeDiagnosis)は変更しない(scoring/aiプロバイダーと同じ差し替え可能パターン)。
 */
export interface AdComplianceProvider {
  readonly name: string;
  check(input: AdComplianceCheckInput): Promise<RawAdRiskFinding[]>;
}
