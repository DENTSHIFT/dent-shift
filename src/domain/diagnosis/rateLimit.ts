// 2026-09-29追加(PO承認、再診断ループの連続実行対策P0): 診断API(/api/diagnosis)の
// 外部AI呼び出しを、サーバー側でスコープ単位(IP/Clinic/Contact)に短時間窓レート制限する
// ための純粋なドメインロジック。DBアクセス・時刻取得は一切行わず、渡された状態と
// 現在時刻から判定結果だけを返す(server/db/diagnosisRateLimitRepository.tsがこの関数を
// DBの行ロック付きトランザクションから呼び出す)。
//
// これはプラン別の無料/有料利用回数制限(PlanEntitlementUsage、別途PO確定後に実装予定)
// とは別物で、あくまで「短時間の連続実行・二重送信・同時実行」を技術的に抑制するための
// ものである。

export type DiagnosisRateLimitScopeType = "ip" | "clinic" | "contact";

export interface DiagnosisRateLimitScopeConfig {
  scopeType: DiagnosisRateLimitScopeType;
  scopeKey: string;
  windowMs: number;
  maxRequests: number;
  // 2026-09-29追加: 同時実行ロック(inFlightSince)を、このスコープの拒否条件として
  // 使うかどうか。IPスコープは院内共有回線等で複数の正当な同時アクセスが起こりうるため
  // 単一実行ロックの対象にせず、回数制限(windowMs/maxRequests)だけで抑制する。
  // Clinic/Contactスコープ(同一医院・同一アカウントの二重クリック/多重タブ対策)では
  // trueにする。
  enforceInFlightLock: boolean;
}

export interface DiagnosisRateLimitStateRow {
  windowStartedAt: Date;
  countInWindow: number;
  inFlightSince: Date | null;
}

export type DiagnosisRateLimitDecision =
  | { allowed: true; nextState: { windowStartedAt: Date; countInWindow: number } }
  | { allowed: false; reason: "in_flight"; retryAt: Date }
  | { allowed: false; reason: "rate_limited"; retryAt: Date };

/**
 * 1スコープ分の判定。inFlightSince(実行中ロック)が有効期限内ならin_flightで拒否。
 * 次に窓(window)が期限切れなら新しい窓としてリセットし、そうでなければ加算した上で
 * 上限を超えていないか判定する。
 *
 * 「未測定分を0点として扱わない」のと同じ思想で、ここでも「まだ実行されていない」
 * (countInWindow===0で窓が古い)ケースと「実行されすぎている」ケースを明確に区別する。
 */
export function evaluateDiagnosisRateLimitScope(
  existing: DiagnosisRateLimitStateRow | null,
  config: Pick<DiagnosisRateLimitScopeConfig, "windowMs" | "maxRequests" | "enforceInFlightLock">,
  inFlightTtlMs: number,
  now: Date
): DiagnosisRateLimitDecision {
  if (config.enforceInFlightLock && existing?.inFlightSince) {
    const inFlightExpiresAt = new Date(existing.inFlightSince.getTime() + inFlightTtlMs);
    if (inFlightExpiresAt > now) {
      return { allowed: false, reason: "in_flight", retryAt: inFlightExpiresAt };
    }
    // inFlightSinceがTTLを超えている場合、サーバークラッシュ等で解放されなかった
    // 古いロックとみなし、新規実行として扱う(古い処理によるロック誤解除の逆、
    // すなわち「解放し忘れられた古いロックに永久にブロックされ続けない」ことを保証する)。
  }

  const windowExpired =
    !existing || now.getTime() - existing.windowStartedAt.getTime() >= config.windowMs;

  if (windowExpired) {
    return {
      allowed: true,
      nextState: { windowStartedAt: now, countInWindow: 1 },
    };
  }

  if (existing.countInWindow >= config.maxRequests) {
    return {
      allowed: false,
      reason: "rate_limited",
      retryAt: new Date(existing.windowStartedAt.getTime() + config.windowMs),
    };
  }

  return {
    allowed: true,
    nextState: { windowStartedAt: existing.windowStartedAt, countInWindow: existing.countInWindow + 1 },
  };
}

/**
 * 複数スコープ(IP/Clinic/Contact)の判定結果から、最終的に許可するかを1つに集約する。
 * 「全条件を満たした場合だけ実行を許可する」というPO指示どおり、1つでも拒否があれば
 * 全体を拒否する(呼び出し側はこの関数がfalseを返した場合、どのスコープの加算も
 * DBへ反映してはならない)。
 */
export function combineDiagnosisRateLimitDecisions(
  decisions: DiagnosisRateLimitDecision[]
): { allowed: true } | { allowed: false; reason: "in_flight" | "rate_limited"; retryAt: Date } {
  const rejected = decisions.filter(
    (d): d is Extract<DiagnosisRateLimitDecision, { allowed: false }> => !d.allowed
  );
  if (rejected.length === 0) {
    return { allowed: true };
  }
  // in_flight(同時実行)の方がrate_limited(回数超過)より即時性の高い理由なので優先して伝える。
  const inFlight = rejected.find((r) => r.reason === "in_flight");
  const chosen = inFlight ?? rejected[0]!;
  // 最も遅いretryAt(最も長く待つ必要がある理由)を採用する。
  const retryAt = rejected.reduce(
    (latest, r) => (r.retryAt > latest ? r.retryAt : latest),
    chosen.retryAt
  );
  return { allowed: false, reason: chosen.reason, retryAt };
}
