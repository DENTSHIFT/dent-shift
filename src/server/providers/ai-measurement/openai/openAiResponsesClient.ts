import type { OpenAiFetchOutcome } from "@/server/providers/ai/openai/openAiResponseTypes";
import type { OpenAiRequestDescriptor } from "./openAiRequestDescriptor";
import type {
  OpenAiResponsesTransport,
  OpenAiTransportResult,
} from "./openAiResponsesTransport";
import {
  normalizeOpenAiResponsesApiResponse,
  OpenAiResponseNormalizationError,
} from "./openAiResponseNormalizer";

/**
 * OpenAiResponsesClient(Phase 1、2026-09-08のユーザー指示)。
 *
 * 責務:
 * - requested modelを保持する
 * - 1質問分のrequestをtransportへ発行する(request構築自体はdescriptorをそのまま
 *   transportへ渡すだけで、実際のResponses API request形状への写像はPhase 3の
 *   transport実装側の責務)
 * - timeout契約(timeoutMsをtransportへ伝える。実際に強制するのはtransport実装)
 * - retry policy(このクライアントが一元管理する。SDK側の自動retryとの二重化を
 *   避けるため、Phase 3で公式SDKを使う場合はSDK側のmaxRetries相当を0に設定する
 *   前提とする。2026-09-08のユーザー指示①)
 * - error classification(retryable/non-retryable)
 * - transport resultをcanonicalな`OpenAiFetchOutcome`へ正規化する
 *
 * canonical業務判定(mentioned判定・measured/reference/unavailable判定等)は
 * 一切行わない。既存openAiAdapter.tsが`OpenAiFetchOutcome`を受け取ってから行う。
 *
 * 【config validationとrequest failureの分離(2026-09-08のユーザー指示)】
 * API key不備・model未設定等の「設定ミス」は、本来provider生成時(Phase 3、
 * OpenAiMeasurementProviderのコンストラクタ)に検証し、そこで例外をthrowすべきで
 * あり、1回のrequest failureとして扱うべきではない。Phase 1はAPI keyも実HTTPも
 * 扱わないため、このクライアント自身は設定検証を行わない(requestedModelは
 * 呼び出し元が既に解決済みの値を渡す前提)。このクライアントが分類するのは
 * あくまで「requestを実際に発行した後に起きた失敗」だけである。
 */
export interface OpenAiResponsesClientOptions {
  /** 1回のrequestに許容する最大待ち時間(ms)。Phase 1ではhardcode production値を
   *  持たず、必ず呼び出し元から明示的に受け取る(env/config defaultはPhase 3で決定)。 */
  timeoutMs: number;
  /** 初回を含めた最大試行回数。省略時はDEFAULT_MAX_ATTEMPTS(3 = initial 1 + retry 2回)。 */
  maxAttempts?: number;
  /** backoff待機を注入可能にする(2026-09-08のユーザー指示: 実時間sleepするunit test
   *  を禁止するため)。省略時は実際にsetTimeoutで待つ実装を使う。 */
  sleep?: (ms: number) => Promise<void>;
  /** backoff時間の算出(注入可能、省略時はDEFAULT_BACKOFFを使う指数backoff)。 */
  computeBackoffMs?: (attempt: number) => number;
}

export const DEFAULT_MAX_ATTEMPTS = 3;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const DEFAULT_BACKOFF_BASE_MS = 500;

function defaultComputeBackoffMs(attempt: number): number {
  // 指数backoff(500ms, 1000ms, 2000ms, ...)。具体的な秒数はPhase 3で見直し可能。
  return DEFAULT_BACKOFF_BASE_MS * 2 ** (attempt - 1);
}

/** 既存canonical語彙とそのまま一致させる(2026-09-08のユーザー指示: 新語彙追加禁止)。 */
type OpenAiFetchFailureReason = Extract<OpenAiFetchOutcome, { ok: false }>["reason"];

interface ClassifiedFailure {
  retryable: boolean;
  reason: OpenAiFetchFailureReason;
  message: string;
}

/**
 * transport失敗をretryable/non-retryableへ分類し、既存canonical語彙
 * ("timeout" | "fetch_failed" | "rate_limited")のいずれかへ対応付ける
 * (2026-09-08のユーザー指示: 新語彙追加禁止)。
 *
 * 【2026-09-08の修正: reasonを事実に忠実にする】以前の版は「timeout・5xxはどちらも
 * 最終的にunavailableReason="temporarily_unavailable"へ収束するから」という理由で
 * 5xx/network_errorをreason="timeout"に寄せていたが、これは実際にtimeoutしていない
 * 失敗をtimeoutと記録してしまい事実に反する(観測の再現性・監査可能性を損なう)ため
 * 修正した。「retryableかどうか」と「最終的なreason」は別軸として扱う。
 *
 * 最終mapping:
 * - timeout(実際にtimeoutした場合のみ): reason="timeout"。retryable。
 * - HTTP 429: reason="rate_limited"。retryable。
 * - network_error(接続断等、timeoutではない): reason="fetch_failed"。retryable。
 * - HTTP 5xx: reason="fetch_failed"。retryable。
 * - HTTP 400/401/403等(4xxのうち429以外): reason="fetch_failed"。non-retryable
 *   (設定ミス・認証エラー等の恒久的失敗であり、リトライしても同じ結果になる可能性が
 *   高いため)。
 * - malformed_response: reason="fetch_failed"。non-retryable(同上)。
 *
 * 既存openAiAdapter.ts側の`OpenAiFetchOutcome.reason`→`UnavailableReason`
 * マッピング(reason==="fetch_failed"→"fetch_failed"、それ以外→
 * "temporarily_unavailable")は今回変更しない。「retryableだがreason="fetch_failed"」
 * という組み合わせ(network_error/5xx)がここで初めて生じるが、そのobservationは
 * unavailableReason="fetch_failed"として保存される(既存adapterのロジックそのまま)。
 * これはこのclient層のretry機構が既に使い切った後の最終結果であり、adapter側は
 * 「retryしたかどうか」を知る必要がないため、この意味変化は許容する
 * (unavailableReasonはあくまで「最終的に何が起きたか」を表す語彙であり、
 * 「retryしたか」はclient内部の実行過程に属する情報のため)。
 */
function classifyTransportFailure(
  result: Extract<OpenAiTransportResult, { ok: false }>
): ClassifiedFailure {
  switch (result.kind) {
    case "timeout":
      return { retryable: true, reason: "timeout", message: result.message };
    case "network_error":
      return { retryable: true, reason: "fetch_failed", message: result.message };
    case "http_error":
      if (result.status === 429) {
        return { retryable: true, reason: "rate_limited", message: result.message };
      }
      if (result.status >= 500) {
        return { retryable: true, reason: "fetch_failed", message: result.message };
      }
      return { retryable: false, reason: "fetch_failed", message: result.message };
    case "malformed_response":
      return { retryable: false, reason: "fetch_failed", message: result.message };
    default: {
      const _exhaustive: never = result;
      throw new Error(`unreachable transport failure kind: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

export class OpenAiResponsesClient {
  constructor(
    private readonly transport: OpenAiResponsesTransport,
    private readonly requestedModel: string,
    private readonly options: OpenAiResponsesClientOptions
  ) {}

  /**
   * 1質問分のdescriptorに対してtransportを呼び出し、retry policyを適用した上で
   * 最終的なOpenAiFetchOutcomeを返す。このメソッド自体がthrowすることはない
   * (transport呼び出し自体が失敗しても、必ずOpenAiFetchOutcomeとして返す)。
   */
  async fetch(descriptor: OpenAiRequestDescriptor): Promise<OpenAiFetchOutcome> {
    const maxAttempts = this.options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    const sleep = this.options.sleep ?? defaultSleep;
    const computeBackoffMs = this.options.computeBackoffMs ?? defaultComputeBackoffMs;

    let lastFailure: ClassifiedFailure | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const result = await this.transport.request({
        requestedModel: this.requestedModel,
        descriptor,
        timeoutMs: this.options.timeoutMs,
      });

      if (result.ok) {
        try {
          const response = normalizeOpenAiResponsesApiResponse(result.raw);
          return { ok: true, response };
        } catch (err) {
          // 正規化失敗(malformed response)は、再試行しても同じ結果になりうる
          // 恒久的失敗として扱い、即座にretryを打ち切る。
          const message =
            err instanceof OpenAiResponseNormalizationError ? err.message : String(err);
          lastFailure = { retryable: false, reason: "fetch_failed", message };
          break;
        }
      }

      const classified = classifyTransportFailure(result);
      lastFailure = classified;
      if (!classified.retryable) {
        break;
      }
      if (attempt < maxAttempts) {
        await sleep(computeBackoffMs(attempt));
      }
    }

    // ループは必ずlastFailureを設定してから終了する(成功時は早期returnするため)。
    const failure = lastFailure!;
    return { ok: false, reason: failure.reason, message: failure.message };
  }
}
