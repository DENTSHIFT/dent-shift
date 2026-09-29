import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "./prismaClient";
import {
  evaluateDiagnosisRateLimitScope,
  combineDiagnosisRateLimitDecisions,
  type DiagnosisRateLimitScopeConfig,
} from "@/domain/diagnosis/rateLimit";
import { DIAGNOSIS_FUNCTION_MAX_DURATION_MS } from "@/server/config/diagnosisFunctionDuration";

/**
 * 2026-09-29追加(PO承認、再診断ループの連続実行対策P0)。
 *
 * 【実際のロック取得方法(PO指摘への対応)】
 * このリポジトリは`prisma.$transaction`のisolationだけで排他制御を主張しない。
 * 実際の排他性は、各スコープごとの更新を「直前に読み取った行の状態(windowStartedAt/
 * countInWindow/inFlightSince/executionId)をWHERE句に含めたUPDATE」として発行し、
 * その`updateMany`のaffected countが1であることで保証する(古典的なCompare-And-Swap)。
 * 単一のUPDATE文はSQLite・Postgresいずれでも対象行に対して常にアトミックであるため、
 * 「読み取った時点の状態のまま」でなければ更新は失敗し(affected=0)、その場合は
 * このモジュールが最初から読み直して再試行する(最大`MAX_CAS_ATTEMPTS`回)。
 * 2つのDialect(開発/テスト=SQLite、Preview/本番=Postgres)の両方で同じコードパスが
 * 動くよう、Postgres専用の`SELECT ... FOR UPDATE`生SQLは使わない
 * (SQLiteはFOR UPDATE構文自体をサポートしないため)。
 *
 * 【実行ごとの識別子(PO指摘への対応)】
 * 予約(reserve)が成功した各スコープ行には、この呼び出し専用の`executionId`
 * (randomUUID)を書き込む。解放(release)は「executionIdが一致する場合のみ」
 * `inFlightSince`/`executionId`をクリアするため、既にTTL経過で別の実行が
 * 同じスコープを再取得した後に、古い実行のfinallyブロックが誤ってその新しい
 * ロックを解放してしまうことがない。
 *
 * 【同時実行チェック失敗時の扱い(PO指摘への対応)】
 * CAS再試行をすべて使い切った場合・DB例外が発生した場合は、呼び出し元に
 * `{ allowed: false, reason: "check_failed" }`を返す。呼び出し元(diagnosis route)は
 * この場合、外部AI呼び出しへ一切進まず、再試行案内(503)を返す(fail-closed)。
 */

const MAX_CAS_ATTEMPTS = 5;

export interface ReserveScopeInput {
  scopeType: DiagnosisRateLimitScopeConfig["scopeType"];
  scopeKey: string;
  windowMs: number;
  maxRequests: number;
  enforceInFlightLock: boolean;
}

export type ReserveDiagnosisSlotResult =
  | { allowed: true; executionId: string }
  | { allowed: false; reason: "in_flight" | "rate_limited"; retryAt: Date }
  | { allowed: false; reason: "check_failed" };

async function ensureRowExists(scopeType: string, scopeKey: string, now: Date) {
  try {
    await prisma.diagnosisRateLimitState.create({
      data: {
        scopeType,
        scopeKey,
        windowStartedAt: now,
        countInWindow: 0,
        inFlightSince: null,
        executionId: null,
      },
    });
  } catch (error) {
    // P2002: 既に他の実行が同時に作成済み(想定内、無視して読み直す)。
    const code = (error as { code?: unknown } | null)?.code;
    if (code !== "P2002") throw error;
  }
}

/**
 * 複数スコープ(IP/Clinic/Contact)を1回の実行として一括で予約する。
 * 「1つでも拒否ならDBへ何も反映しない」を保証するため、まず全スコープを読み取り・
 * 評価し、すべて許可の場合のみCAS UPDATEを発行する。CAS UPDATEが1件でも
 * 失敗(=他の実行が割り込んだ)した場合は、最初からやり直す。
 */
export async function reserveDiagnosisSlot(
  scopes: ReserveScopeInput[],
  now: Date = new Date()
): Promise<ReserveDiagnosisSlotResult> {
  const executionId = randomUUID();
  const inFlightTtlMs = DIAGNOSIS_INFLIGHT_LOCK_TTL_MS;

  for (let attempt = 1; attempt <= MAX_CAS_ATTEMPTS; attempt++) {
    try {
      for (const scope of scopes) {
        await ensureRowExists(scope.scopeType, scope.scopeKey, now);
      }

      const currentRows = await Promise.all(
        scopes.map((scope) =>
          prisma.diagnosisRateLimitState.findUniqueOrThrow({
            where: { scopeType_scopeKey: { scopeType: scope.scopeType, scopeKey: scope.scopeKey } },
          })
        )
      );

      const decisions = scopes.map((scope, i) => {
        const row = currentRows[i]!;
        return evaluateDiagnosisRateLimitScope(
          {
            windowStartedAt: row.windowStartedAt,
            countInWindow: row.countInWindow,
            inFlightSince: row.inFlightSince,
          },
          scope,
          inFlightTtlMs,
          now
        );
      });

      const combined = combineDiagnosisRateLimitDecisions(decisions);
      if (!combined.allowed) {
        return combined;
      }

      // 全スコープ許可 → 直前に読んだ行の状態をWHEREへ含めたCAS UPDATEで確定する。
      // 1つでもaffected=0(他の実行が割り込んだ)なら、この試行全体を破棄して読み直す。
      let allCasSucceeded = true;
      for (let i = 0; i < scopes.length; i++) {
        const scope = scopes[i]!;
        const row = currentRows[i]!;
        const decision = decisions[i]!;
        if (!decision.allowed) continue; // 型ガード(ここには到達しないはず)

        const result = await prisma.diagnosisRateLimitState.updateMany({
          where: {
            scopeType: scope.scopeType,
            scopeKey: scope.scopeKey,
            windowStartedAt: row.windowStartedAt,
            countInWindow: row.countInWindow,
            inFlightSince: row.inFlightSince,
          },
          data: {
            windowStartedAt: decision.nextState.windowStartedAt,
            countInWindow: decision.nextState.countInWindow,
            inFlightSince: now,
            executionId,
          },
        });
        if (result.count !== 1) {
          allCasSucceeded = false;
          break;
        }
      }

      if (allCasSucceeded) {
        return { allowed: true, executionId };
      }
      // CAS失敗 → 次のattemptで読み直す(このattemptで一部のスコープだけCAS成功して
      // いた場合も、そのスコープのinFlightSince/executionIdは今回のexecutionIdの
      // ままDBに残ってしまうため、明示的にロールバックする)。
      await Promise.all(
        scopes.map((scope) =>
          prisma.diagnosisRateLimitState.updateMany({
            where: { scopeType: scope.scopeType, scopeKey: scope.scopeKey, executionId },
            data: { inFlightSince: null, executionId: null },
          })
        )
      );
    } catch (error) {
      console.error(
        `[diagnosisRateLimitRepository] reserve attempt ${attempt} failed:`,
        error instanceof Error ? error.name : "UnknownError"
      );
      if (attempt >= MAX_CAS_ATTEMPTS) {
        return { allowed: false, reason: "check_failed" };
      }
      await new Promise((resolve) => setTimeout(resolve, 30 * attempt));
    }
  }
  return { allowed: false, reason: "check_failed" };
}

/**
 * 予約したスコープを解放する(診断処理の成功・失敗を問わずfinallyから呼ぶ)。
 * executionIdが一致する行だけを解放するため、TTL経過で別の実行が同じスコープを
 * 再取得した後に誤って新しいロックを解放することはない。
 */
export async function releaseDiagnosisSlot(
  scopes: Pick<ReserveScopeInput, "scopeType" | "scopeKey">[],
  executionId: string
): Promise<void> {
  await Promise.all(
    scopes.map((scope) =>
      prisma.diagnosisRateLimitState
        .updateMany({
          where: { scopeType: scope.scopeType, scopeKey: scope.scopeKey, executionId },
          data: { inFlightSince: null, executionId: null },
        })
        .catch((error) => {
          console.error(
            "[diagnosisRateLimitRepository] release failed:",
            error instanceof Error ? error.name : "UnknownError"
          );
        })
    )
  );
}

/**
 * 実行中ロックのTTL。PO指摘(2026-09-29、2回目)「TTLの根拠は、実測時間ではなく
 * デプロイの設定上限と処理の終了条件で確認すること」に対応し、Vercel Runtime Logs等の
 * 実測値ではなく、コード上の2つの根拠だけを使う。
 * 1. デプロイの設定上限: /api/diagnosis Route Handler自体に明示設定した
 *    `maxDuration`(src/app/api/diagnosis/route.ts)。Vercelはこの上限を超えたFunction
 *    実行を強制終了するため、これが処理時間の絶対的な上限になる。
 * 2. 処理の終了条件: canonical AI計測(OpenAI呼び出し)は
 *    timeoutMs×maxAttempts+backoff(src/server/config/aiMeasurementConfig.ts)で
 *    自ら打ち切られるよう設計されており、質問間はPromise.allで並列実行のため
 *    直列には積み上がらない。
 * 両方の根拠となる値は`DIAGNOSIS_FUNCTION_MAX_DURATION_MS`
 * (src/server/config/diagnosisFunctionDuration.ts)に一元化してある。
 * このTTLは、Functionが強制終了された後もロックだけがinFlight状態で残り続けない
 * よう、その値に安全マージンを加えた値にする。
 */
export const DIAGNOSIS_MAX_EXECUTION_MS = DIAGNOSIS_FUNCTION_MAX_DURATION_MS;
const LOCK_SAFETY_MARGIN_MS = 30 * 1000;
export const DIAGNOSIS_INFLIGHT_LOCK_TTL_MS = DIAGNOSIS_MAX_EXECUTION_MS + LOCK_SAFETY_MARGIN_MS;
