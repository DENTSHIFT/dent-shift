import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prismaClient";
import { DIAGNOSIS_INFLIGHT_LOCK_TTL_MS } from "./diagnosisRateLimitRepository";

/** prisma.$transaction()のコールバック引数として渡される、tx用クライアントの型。 */
export type DiagnosisIdempotencyTransactionClient = Prisma.TransactionClient;

/**
 * 2026-09-29追加(PO承認、再診断ループの連続実行対策P0。2026-09-29のPO指摘により
 * 主体紐付け・入力一致・実行identifierを追加した改訂版)。
 *
 * クライアント発行の`clientRequestId`単位で、同じ論理リクエストの再送(タイムアウト後の
 * 再送・二重クリックによる多重送信)が外部AI呼び出しを再実行しないようにする。
 *
 * 【主体紐付け(PO指摘への対応)】
 * `principalKey`(ログイン中はcontactId、匿名はIPハッシュ)をclientRequestIdと一緒に
 * 記録する。別の主体が同じclientRequestIdを(推測・偶然の衝突・悪意により)送っても、
 * 完了済みの結果(diagnosisId)を取得できない("principal_mismatch"を返し、
 * diagnosisIdは一切含めない)。
 *
 * 【入力一致の検証(PO指摘への対応)】
 * 初回リクエスト本文から計算したハッシュ(`inputHash`)も記録する。同じ
 * clientRequestIdで異なる入力(医院名・URL等)が送られた場合は"input_mismatch"を
 * 返して拒否する(冪等性キーは「同じリクエストの再送」だけを意味し、
 * 「同じIDを使い回した別内容のリクエスト」を通さない)。
 *
 * 【実行identifierによる正確な引き継ぎ(PO指摘への対応)】
 * 各実行(new/takeover)は専用の`executionId`を発行する。完了・失敗の記録
 * (markDiagnosisIdempotencyLockCompleted/Failed)はこのexecutionIdが現在も一致する
 * 場合のみ反映される(updateManyのWHEREへ含める)。これにより、「ロック期限切れ後に
 * 新しい実行が引き継いだ後、旧処理(クラッシュから復帰した、または単に遅かった処理)が
 * 後から完了/失敗を書き込もうとしても、新しい実行の状態を上書きしない」ことを保証する。
 */

export type AcquireIdempotencyLockResult =
  | { kind: "new"; executionId: string }
  | { kind: "in_progress" }
  | { kind: "completed"; diagnosisId: string }
  | { kind: "principal_mismatch" }
  | { kind: "input_mismatch" };

async function tryCreate(
  clientRequestId: string,
  principalKey: string,
  inputHash: string,
  now: Date
): Promise<{ executionId: string } | null> {
  const executionId = randomUUID();
  try {
    await prisma.diagnosisIdempotencyLock.create({
      data: { clientRequestId, status: "in_progress", principalKey, inputHash, executionId, createdAt: now },
    });
    return { executionId };
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    if (code !== "P2002") throw error;
    return null;
  }
}

export async function acquireDiagnosisIdempotencyLock(
  clientRequestId: string,
  principalKey: string,
  inputHash: string,
  now: Date = new Date()
): Promise<AcquireIdempotencyLockResult> {
  const created = await tryCreate(clientRequestId, principalKey, inputHash, now);
  if (created) return { kind: "new", executionId: created.executionId };

  const existing = await prisma.diagnosisIdempotencyLock.findUnique({ where: { clientRequestId } });
  if (!existing) {
    // 直前に他の実行が削除した等の極めて稀な競合。最初からやり直す。
    return acquireDiagnosisIdempotencyLock(clientRequestId, principalKey, inputHash, now);
  }

  // 主体不一致: 別の主体(別アカウント・別匿名IP)が同じIDを使おうとした。
  // 完了済みでもdiagnosisIdを一切返さない。
  if (existing.principalKey !== principalKey) {
    return { kind: "principal_mismatch" };
  }
  // 入力不一致: 同じ主体でも、リクエスト内容が初回と異なる。
  if (existing.inputHash !== inputHash) {
    return { kind: "input_mismatch" };
  }

  if (existing.status === "completed" && existing.diagnosisId) {
    return { kind: "completed", diagnosisId: existing.diagnosisId };
  }

  if (existing.status === "in_progress") {
    const ageMs = now.getTime() - existing.createdAt.getTime();
    if (ageMs <= DIAGNOSIS_INFLIGHT_LOCK_TTL_MS) {
      return { kind: "in_progress" };
    }
    // TTLを超えて"in_progress"のまま = 古い実行が解放しなかった(クラッシュ等)。
    // 新しいexecutionIdを発行して引き継ぐ。CAS(createdAt一致)により、複数の実行が
    // 同時に引き継ごうとする競合を1つだけに絞る。
    const newExecutionId = randomUUID();
    const takeover = await prisma.diagnosisIdempotencyLock.updateMany({
      where: { clientRequestId, status: "in_progress", createdAt: existing.createdAt },
      data: { status: "in_progress", createdAt: now, diagnosisId: null, completedAt: null, executionId: newExecutionId },
    });
    if (takeover.count === 1) {
      return { kind: "new", executionId: newExecutionId };
    }
    return { kind: "in_progress" };
  }

  // status === "failed"(レート制限拒否・エラー等で解放済み) → 新規実行として引き継ぐ。
  const newExecutionId = randomUUID();
  const reset = await prisma.diagnosisIdempotencyLock.updateMany({
    where: { clientRequestId, status: existing.status },
    data: { status: "in_progress", createdAt: now, diagnosisId: null, completedAt: null, executionId: newExecutionId },
  });
  if (reset.count === 1) {
    return { kind: "new", executionId: newExecutionId };
  }
  return acquireDiagnosisIdempotencyLock(clientRequestId, principalKey, inputHash, now);
}

/**
 * 2026-09-29追加(PO指摘、2回目: 確認した直後に別処理が実行権を取得すると、古い処理も
 * 保存できてしまう。実行権の条件付き更新・Clinic/Diagnosis保存・冪等性レコードの
 * 完了記録を、同じDBトランザクションで確定すること)。
 *
 * 「確認してから保存する」という2段階の方式(このコミット以前の
 * isDiagnosisIdempotencyLockStillCurrent()関数、既に削除済み)は、確認と保存の間に
 * 別の実行が割り込む窓(TOCTOU)をまだ残していた。この関数は、その窓を作らないよう、
 * 「実行権の条件付き更新」を「完了記録」と同じトランザクションの中の1ステップに
 * するための、トランザクション内専用ヘルパー。実際のClinic/Diagnosis保存は
 * このトランザクションの中でsrc/server/db/diagnosisRepository.tsの
 * saveDiagnosisResultIfIdempotencyLockCurrent()が行う(diagnosisRepository.ts側が
 * 同じtxクライアントでこの関数とClinic/Diagnosis作成の両方を呼ぶことで、DB全体として
 * 1つのトランザクションになる)。
 *
 * 呼び出し元は、このtx内で`count!==1`の場合に必ずロールバックとなる例外をthrowする
 * こと(この関数自体は例外を投げず、真偽値だけを返す)。
 */
export async function claimDiagnosisIdempotencyLockExecutionInTransaction(
  tx: DiagnosisIdempotencyTransactionClient,
  clientRequestId: string,
  executionId: string
): Promise<boolean> {
  const result = await tx.diagnosisIdempotencyLock.updateMany({
    where: { clientRequestId, executionId, status: "in_progress" },
    data: { status: "in_progress" },
  });
  return result.count === 1;
}

/**
 * claimDiagnosisIdempotencyLockExecutionInTransaction()と同じトランザクション内で、
 * Clinic/Diagnosis保存の直後に呼ぶ。executionIdが現在も一致する場合のみ完了として
 * 記録する(claim済みのため、通常はここでcount!==1にはならない。念のためのCAS)。
 */
export async function markDiagnosisIdempotencyLockCompletedInTransaction(
  tx: DiagnosisIdempotencyTransactionClient,
  clientRequestId: string,
  executionId: string,
  diagnosisId: string
): Promise<void> {
  await tx.diagnosisIdempotencyLock.updateMany({
    where: { clientRequestId, executionId, status: "in_progress" },
    data: { status: "completed", diagnosisId, completedAt: new Date() },
  });
}

/**
 * 2026-09-29修正(PO指摘への対応、堅牢化): status:"in_progress"の行だけを対象にする。
 * 既に"completed"へ確定した行(atomic saveトランザクションの完了後、後続の
 * Salesforce同期・メール送信側の例外がこの関数を誤って呼んでしまった場合)を、
 * 誤って"failed"へ書き換えてしまわないためのガード。
 */
export async function markDiagnosisIdempotencyLockFailed(
  clientRequestId: string,
  executionId: string
): Promise<void> {
  await prisma.diagnosisIdempotencyLock
    .updateMany({
      where: { clientRequestId, executionId, status: "in_progress" },
      data: { status: "failed" },
    })
    .catch((error) => {
      console.error(
        "[diagnosisIdempotencyRepository] mark failed failed:",
        error instanceof Error ? error.name : "UnknownError"
      );
    });
}
