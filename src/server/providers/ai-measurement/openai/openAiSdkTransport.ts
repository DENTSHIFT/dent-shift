import "server-only";
import OpenAI from "openai";
import type { OpenAiRequestDescriptor } from "./openAiRequestDescriptor";
import type {
  OpenAiRawResponseLike,
  OpenAiResponsesTransport,
  OpenAiTransportRequest,
  OpenAiTransportResult,
} from "./openAiResponsesTransport";

/**
 * OpenAiResponsesTransportの実SDK実装(Phase 3、2026-09-08のユーザー指示)。
 *
 * 責務(このファイルに許可される範囲):
 * - OpenAI公式Node SDK(`openai`パッケージ)のclientを構築・保持する
 * - OpenAiRequestDescriptorをSDKのresponses.create()リクエスト形状へ写像する
 * - SDK responseを`OpenAiRawResponseLike`へ変換する(必要フィールドのみpick。
 *   raw応答全体をそのまま保持・返却しない)
 * - SDK側のエラーを`OpenAiTransportResult`(timeout/network_error/http_error/
 *   malformed_response)へ分類する(事実ベースのkind/statusのみ。retryable判定・
 *   最終的なcanonical unavailableReasonへのマッピングは行わない。それは
 *   `OpenAiResponsesClient`(Phase 1、このファイルでは無変更)の責務)
 *
 * 【禁止】mentioned判定・clinic matching・competitor抽出・measured/reference/
 * unavailable判定等のbusiness logicは一切持ち込まない。
 *
 * 【retry二重化防止(2026-09-08のユーザー指示①)】Phase 1で確定済みの方針どおり、
 * retry policyは`OpenAiResponsesClient`が一元管理する。SDK自身の自動retry
 * (デフォルト2回)は`maxRetries: 0`で無効化し、二重retryを防ぐ(実clientを自前
 * 構築する場合のみ。テストでclientを注入する場合はこのファイルの責務外)。
 *
 * 【server-only】OPENAI_API_KEYを扱うこのファイルがclient componentから誤って
 * importされた場合にNext.jsのbuildが確実に失敗するよう、`server-only`パッケージを
 * 先頭でimportする(Next.js公式の推奨パターン。2026-09-08のユーザー指示)。
 *
 * 【openai v7.10.0互換性の確認状況(2026-09-08のユーザー指示のPhase 3.1ラウンド)】
 * openai-node公式リポジトリのタグ`v7.10.0`のソース(client.ts/core/error.ts)を直接
 * 確認し、以下は変更なしであることを確認した: デフォルトexport(`export { OpenAI as
 * default }`)、`new OpenAI({apiKey, maxRetries: 0})`のコンストラクタ形状、
 * `client.responses`プロパティの存在、`OpenAI.APIError`/`OpenAI.APIConnectionError`/
 * `OpenAI.APIConnectionTimeoutError`の静的プロパティとそのextends階層、
 * `ResponsesModel`が`(string & {})`を含み任意のmodel文字列を受け付けること、
 * response出力側の`web_search_call`item(`type: 'web_search_call'`)。
 * 一方、request側の`Tool`/`WebSearchTool`/`ToolChoiceOptions`という具体的な型名・
 * 完全な定義は、生成された型定義ファイルが大きく、本ラウンドで用いた調査手段
 * (リモートfetch+要約)では確認しきれなかった(型を通すためだけの`as any`は追加せず、
 * 代わりに独自のローカル型のまま維持している。`tools`/`tool_choice`の実際の値
 * 自体はOpenAI公式APIドキュメント(developers.openai.com、wire format)で確認済み)。
 * Mac実機で`npm install`後の`npx tsc --noEmit`が、この関数(`buildSdkRequestBody`の
 * 呼び出し箇所)で型不一致を報告した場合は、実際の型定義を確認のうえ追加修正する。
 */

/**
 * テスト用の注入ポイント(2026-09-08のユーザー指示: 「OpenAI SDK clientをinterface/
 * wrapper注入できる構造にしてfake response/errorでtestしてください」)。
 * 実SDKの型定義への依存を最小限にするため、意図的にゆるい型(unknown)にしている。
 * 実際の`OpenAI`インスタンスの`responses.create`メソッドは、メソッド構文の
 * パラメータ双方向互換性チェックによりこのシグネチャを構造的に満たす。
 */
export interface OpenAiSdkResponsesClientLike {
  responses: {
    create(body: unknown, options?: { timeout?: number }): Promise<unknown>;
  };
}

export interface OpenAiSdkTransportOptions {
  /** OpenAI API key。server-onlyであること前提(このファイル自体もserver-only)。
   *  APIレスポンス・ログ・エラーメッセージのいずれにもこの値を含めない。 */
  apiKey: string;
  /** テスト用: 実際のOpenAI SDK clientの代わりに注入するfake/wrapper。
   *  省略時のみ、実際に`new OpenAI({apiKey, maxRetries: 0})`を構築する。 */
  client?: OpenAiSdkResponsesClientLike;
}

export class OpenAiSdkTransport implements OpenAiResponsesTransport {
  readonly name = "openai-sdk-transport";
  private readonly client: OpenAiSdkResponsesClientLike;

  constructor(options: OpenAiSdkTransportOptions) {
    // 2026-09-08のユーザー指示①: DENT SHIFT側(OpenAiResponsesClient)がretryを
    // 一元管理するため、SDK自身の自動retry(デフォルト2)をここで無効化する。
    this.client = options.client ?? new OpenAI({ apiKey: options.apiKey, maxRetries: 0 });
  }

  async request(input: OpenAiTransportRequest): Promise<OpenAiTransportResult> {
    try {
      const body = buildSdkRequestBody(input.descriptor);
      const rawResponse = await this.client.responses.create(body, {
        timeout: input.timeoutMs,
      });
      return { ok: true, raw: toRawResponseLike(rawResponse) };
    } catch (err) {
      return classifySdkError(err);
    }
  }
}

/**
 * OpenAiRequestDescriptorをResponses APIのrequest body形状へ写像する純粋関数。
 * clinicName/clinicUrl/competitor名はdescriptor自体にそもそも存在しないため、
 * ここでも一切参照・追加しない(2026-09-08のユーザー指示)。
 * developer instructionとuser questionはResponses APIの別々のtop-levelパラメータ
 * (`instructions`/`input`)へ写像し、1つの文字列へ連結しない(Phase 1のdescriptor
 * 設計における instruction/data境界の意味を変えない)。
 * user_locationはOpenAI公式仕様どおりtools[]内のweb_search tool定義に含める
 * (top-levelパラメータではない)。city/region/timezoneは発明せず、Phase 1
 * descriptorが持つcountryのみを渡す。
 */
function buildSdkRequestBody(descriptor: OpenAiRequestDescriptor): {
  model: string;
  instructions: string;
  input: string;
  tools: Array<{
    type: "web_search";
    user_location: { type: "approximate"; country: string };
  }>;
  // descriptor.toolChoiceのリテラル型("required")をそのまま使う(意図的に`string`へ
  // 広げない。2026-09-08のユーザー指示のPhase 3.1ラウンド: 型を通すためだけに
  // `as any`や不必要な型の広げすぎを行わないため)。
  tool_choice: OpenAiRequestDescriptor["toolChoice"];
} {
  return {
    model: descriptor.model,
    instructions: descriptor.developerInstruction,
    input: descriptor.userQuestion,
    tools: [
      {
        type: "web_search",
        user_location: {
          type: "approximate",
          country: descriptor.userLocation.country,
        },
      },
    ],
    tool_choice: descriptor.toolChoice,
  };
}

/**
 * SDK responseから`OpenAiRawResponseLike`が必要とするフィールドだけを個別にpickして
 * 新しいオブジェクトを構築する(raw応答全体をそのままコピー・保持しない。既存
 * normalizer(openAiResponseNormalizer.ts、Phase 1、無変更)と同じ方針)。
 * id/model欠落等の構造異常はここでは検出せず、空文字/空配列としてそのまま
 * `normalizeOpenAiResponsesApiResponse()`側の既存検証(OpenAiResponseNormalizationError)
 * に委ねる(検証ロジックの二重実装を避ける)。
 */
function toRawResponseLike(rawResponse: unknown): OpenAiRawResponseLike {
  const r = (rawResponse ?? {}) as Record<string, unknown>;
  const usage = r.usage as Record<string, unknown> | undefined;
  return {
    id: typeof r.id === "string" ? r.id : "",
    model: typeof r.model === "string" ? r.model : "",
    output: Array.isArray(r.output)
      ? (r.output as Array<{ type: string; [key: string]: unknown }>)
      : [],
    usage: usage
      ? {
          input_tokens: typeof usage.input_tokens === "number" ? usage.input_tokens : undefined,
          output_tokens: typeof usage.output_tokens === "number" ? usage.output_tokens : undefined,
          total_tokens: typeof usage.total_tokens === "number" ? usage.total_tokens : undefined,
        }
      : undefined,
  };
}

/**
 * SDKエラーをtransport resultへ分類する(2026-09-08のユーザー指示: 「事実ベースの
 * kind/statusだけ返す」。retryable判定・canonical unavailableReasonへの最終
 * マッピングはOpenAiResponsesClient(Phase 1、無変更)の責務であり、ここでは行わない。
 * 新しいcanonical unavailableReason語彙もここでは一切追加しない)。
 *
 * 公式SDK(openai-node)のエラー階層: `OpenAI.APIConnectionTimeoutError`は
 * `OpenAI.APIConnectionError`のサブクラスであるため、先に判定する。
 * `OpenAI.APIError`(400/401/403/404/409/422/429/5xx等の具象subclassの基底、
 * すべてstatusプロパティを持つ)はstatusを読むだけで、個別のsubclass名には
 * 依存しない(SDKのバージョン差異でsubclass一覧が変わっても壊れないようにするため)。
 */
function classifySdkError(err: unknown): Extract<OpenAiTransportResult, { ok: false }> {
  // err.messageへのアクセスはinstanceof narrowingに頼らず、明示的に(err as Error)へ
  // castして取り出す(すべてOpenAIErrorひいてはErrorのsubclassである前提。
  // 2026-09-08のユーザー指示のPhase 3ラウンドで、"openai"パッケージの型解決に
  // 依存しない書き方へ強化した)。
  if (err instanceof OpenAI.APIConnectionTimeoutError) {
    return { ok: false, kind: "timeout", message: (err as Error).message };
  }
  if (err instanceof OpenAI.APIConnectionError) {
    return { ok: false, kind: "network_error", message: (err as Error).message };
  }
  if (err instanceof OpenAI.APIError) {
    const status =
      typeof (err as { status?: unknown }).status === "number"
        ? (err as { status: number }).status
        : undefined;
    if (status !== undefined) {
      return { ok: false, kind: "http_error", status, message: (err as Error).message };
    }
  }
  // 想定外のエラー形状(SDKバージョン差異・未知の例外等)は安全側でmalformed_response
  // として扱う(握りつぶさず、必ずOpenAiTransportResultとして返す)。
  const message = err instanceof Error ? err.message : String(err);
  return { ok: false, kind: "malformed_response", message };
}
