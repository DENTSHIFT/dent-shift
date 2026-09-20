/**
 * LINE WORKS Bot経由の通知メッセージ送信インターフェース(仕様書Ver3.3 6章)。
 * 実際のAPI仕様(認証フロー・エンドポイント・payload形式)は開通後に確定するため、
 * ここではメッセージ送信という用途だけを固定し、実装詳細はlineWorksClient.tsへ
 * 分離する(smsProvider/salesforceClientと同じAdapter分離パターン)。
 */
export interface LineWorksMessageInput {
  accountId: string;
  text: string;
}

export interface LineWorksMessenger {
  sendMessage(input: LineWorksMessageInput): Promise<void>;
}
