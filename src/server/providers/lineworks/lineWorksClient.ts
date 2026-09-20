import "server-only";
import type { EnabledLineWorksConfig } from "@/server/config/lineWorksConfig";
import type { LineWorksMessageInput, LineWorksMessenger } from "./types";

export class LineWorksDeliveryError extends Error {}

/**
 * LINE WORKS Bot APIクライアント(仕様書Ver3.3 6章)。
 *
 * 重要: LINE WORKS側の実際の認証方式(Service Account JWT等)・Bot APIエンドポイント・
 * payload形式は開通(約3営業日)・契約確認前で未確定。ここではconfig/adapter層の
 * 構造だけを先行して用意し、開通後に実装する(仕様書11章「外部サービスをコードへ
 * 密結合させない」原則、salesforceClient.ts/twilioVerifySmsProvider.tsと同じ分離)。
 * 実装が確定するまでは呼び出すと明示的にエラーになる(silent no-opにしない)。
 */
export function createLineWorksClient(config: EnabledLineWorksConfig): LineWorksMessenger {
  return {
    async sendMessage(_input: LineWorksMessageInput): Promise<void> {
      void config;
      throw new LineWorksDeliveryError(
        "LINE WORKS連携は開通・API仕様確定待ちのため未実装です(STEP6報告事項)。"
      );
    },
  };
}
