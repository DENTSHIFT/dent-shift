import type { OpenAiRequestDescriptor } from "./openAiRequestDescriptor";

/**
 * OpenAI Responses APIへの実HTTP/SDK通信を抽象化するtransport層(Phase 1、2026-09-08の
 * ユーザー指示)。
 *
 * 【重要な境界】このinterface自体はSDK/HTTPのどちらの実装にも依存しない。Phase 1では
 * ネットワーク通信を一切行わず、テストからfake transport(tests/fixtures/openai/
 * fakeOpenAiResponsesTransport.ts)を実装して`OpenAiResponsesClient`の契約(リトライ/
 * timeout/エラー分類)だけを検証する。Phase 3で公式SDK(またはfetch)ベースの実装
 * (例: OpenAiSdkResponsesTransport)へ差し替える想定であり、`OpenAiResponsesClient`
 * 側のコードは一切変更不要になるように設計する。
 *
 * canonical business判定(mentioned判定・clinic matching・competitor抽出・
 * measured/reference/unavailable判定)はこの層に一切持ち込まない。この層の責務は
 * 「1回のHTTP的なやり取りを行い、結果を成功/失敗の形で返す」ことだけ。
 */
export interface OpenAiTransportRequest {
  /** env(OPENAI_AI_MEASUREMENT_MODEL等、Phase 3で導入)から解決されたrequested model。 */
  requestedModel: string;
  descriptor: OpenAiRequestDescriptor;
  /** このrequestに許容する最大待ち時間(ms)。実際にタイムアウトを強制するのはPhase 3の
   *  実transport実装(AbortController等)の責務であり、この層は値を右から左へ渡すだけ。 */
  timeoutMs: number;
}

/**
 * transportが返しうる「生」の応答shape(SDK/APIレスポンスの必要最小限)。
 * 既存の`OpenAiResponseFixture`(src/server/providers/ai/openai/openAiResponseTypes.ts)
 * とは意図的に別の型にしている(2026-09-08のユーザー指示②: SDK response正規化境界の明示)。
 * `output[]`の要素は`type`以外の構造を保証しない(実APIが将来出力する未知の
 * item種別を安全に無視できるようにするため)。
 */
export interface OpenAiRawOutputItemLike {
  type: string;
  [key: string]: unknown;
}

export interface OpenAiRawUsageLike {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
}

export interface OpenAiRawResponseLike {
  id: string;
  model: string;
  output: OpenAiRawOutputItemLike[];
  usage?: OpenAiRawUsageLike;
}

/**
 * transport呼び出し1回分の結果(成功/失敗)。失敗の種類(kind)は、実HTTP/SDK層が
 * 分類できる最小限の粒度に留める(canonical `OpenAiFetchOutcome.reason`への最終的な
 * マッピング判断は`OpenAiResponsesClient`側の責務であり、このtransport層自身は
 * canonical語彙を知らない)。
 *
 * - "timeout": timeoutMsを超過した(client側の待ち時間超過。実装はPhase 3で
 *   AbortController等により行う)
 * - "network_error": DNS解決失敗・接続断等、HTTPレスポンス自体を受け取れなかった場合
 * - "http_error": HTTPレスポンスは受け取ったが2xx以外だった場合(status保持)
 * - "malformed_response": 2xxだが応答bodyが期待する構造ではなかった場合
 */
export type OpenAiTransportResult =
  | { ok: true; raw: OpenAiRawResponseLike }
  | { ok: false; kind: "timeout"; message: string }
  | { ok: false; kind: "network_error"; message: string }
  | { ok: false; kind: "http_error"; status: number; message: string }
  | { ok: false; kind: "malformed_response"; message: string };

/**
 * OpenAI Responses APIへの実際の通信を担うtransport(Phase 1ではinterfaceのみ確定し、
 * 実装(SDKベース/fetchベース)はPhase 3で追加する)。API keyの保持・付与もこの層
 * (の実装)の責務であり、Phase 1のinterface自体にはAPI keyの概念を含めない
 * (2026-09-08のユーザー指示: 「API keyそのものはPhase 1では不要」)。
 */
export interface OpenAiResponsesTransport {
  readonly name: string;
  request(input: OpenAiTransportRequest): Promise<OpenAiTransportResult>;
}
