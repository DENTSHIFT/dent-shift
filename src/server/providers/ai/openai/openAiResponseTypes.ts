/**
 * OpenAI Responses API(`web_search`ツール使用時)の応答のうち、この adapter が実際に
 * パースする範囲だけをモデル化した最小限の型(設計書3章・C章)。
 * OpenAI公式SDKの完全な型定義を持ち込むのではなく、fixtureベースのunit testが必要とする
 * フィールドのみを定義する(2026-09-07のユーザー指示: まだ実API接続はしないため、
 * 実際のSDK/HTTPクライアントには一切依存しない)。
 */

export interface OpenAiWebSearchCallItem {
  type: "web_search_call";
  id: string;
  status: string;
  action?: {
    type: string;
    query?: string;
  };
}

export interface OpenAiUrlCitationAnnotation {
  type: "url_citation";
  url: string;
  title?: string;
  start_index?: number;
  end_index?: number;
}

export interface OpenAiMessageContentItem {
  type: "output_text";
  text: string;
  annotations?: OpenAiUrlCitationAnnotation[];
}

export interface OpenAiMessageItem {
  type: "message";
  role: "assistant";
  content: OpenAiMessageContentItem[];
}

export type OpenAiOutputItem = OpenAiWebSearchCallItem | OpenAiMessageItem;

export interface OpenAiUsage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
}

/** 成功応答(fixture)。実際のOpenAI Responses APIレスポンスのうち必要な部分のみ。 */
export interface OpenAiResponseFixture {
  id: string;
  model: string;
  output: OpenAiOutputItem[];
  usage?: OpenAiUsage;
}

/**
 * provider呼び出しの結果(成功/失敗の両方を表現する)。まだ実ネットワーク呼び出しは
 * 行わないため、このunion自体はfixtureが直接この形で表現する
 * (実装時、実際のHTTPクライアント呼び出し箇所がtry/catchでこの形へ変換する想定)。
 */
export type OpenAiFetchOutcome =
  | { ok: true; response: OpenAiResponseFixture }
  | { ok: false; reason: "timeout" | "fetch_failed" | "rate_limited"; message: string };
