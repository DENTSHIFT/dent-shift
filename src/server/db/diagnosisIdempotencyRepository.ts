import "server-only";
import { prisma } from "./prismaClient";
import { DIAGNOSIS_INFLIGHT_LOCK_TTL_MS } from "./diagnosisRateLimitRepository";

/**
 * 2026-09-29追加(PO承認、再診断ループの連続実行対策P0): クライアント発行の
 * `clientRequestId`単位で、同じ論理リクエストの再送(タイムアウト後の再送・
 * 二重クリックによる多重送信)が外部AI呼び出しを再実行しないようにする。
 *
 * 「同じリクエストの再送で外部AIを再実行しない仕組み」(PO指摘)は、この冪等性
 * ロックがreserveDiagnosisSlot(スコープ単位のレート制限)より前段で判定される
 * ことで実現する。同一clientRequestIdの2回目以降の到達は、1回目が完了していれば
 * その結果をそのまま返し、実行中ならAI呼び出しに一切進まず待機案内を返す
 * (レート制限のカウントも消費しない)。
 */

export type AcquireIdempotencyLockResult =
  | { kind: "new" }
  | { kind: "in_progress" }
  | { kind: "completed"; diagnosisId: string };

export async function acquireDiagnosisIdempotencyLock(
  clientRequestId: string,
  now: Date = new Date()
): Promise<AcquireIdempotencyLockResult> {
  try {
    await prisma.diagnosisIdempotencyLock.create({
      data: { clientRequestId, status: "in_progress", createdAt: now },
    });
    return { kind: "new" };
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    if (code !== "P2002") throw error;
  }

  const existing = await prisma.diagnosisIdempotencyLock.findUnique({ where: { clientRequestId } });
  if (!existing) {
    // 極めて稀な競合(直前にfindUniqueした行が削除された等)。呼び出し元にnewとして
    // 再試行させる。
    return acquireDiagnosisIdempotencyLock(clientRequestId, now);
  }

  if (existing.status === "completed" && existing.diagnosisId) {
    return { kind: "completed", diagnosisId: existing.diagnosisId };
  }

  if (existing.status === "in_progress") {
    const ageMs = now.getTime() - existing.createdAt.getTime();
    if (ageMs <= DIAGNOSIS_INFLIGHT_LOCK_TTL_MS) {
      return { kind: "in_progress" };
    }
    // TTLを超えて"in_progress"のまま = サーバークラッシュ等で解放されなかった
    // 古いロック。この実行が引き継ぐ(CASでcreatedAtが変わっていないことを確認してから
    // 更新することで、複数の実行が同時に引き継ごうとする競合を防ぐ)。
    const takeover = await prisma.diagnosisIdempotencyLock.updateMany({
      where: { clientRequestId, status: "in_progress", createdAt: existing.createdAt },
      data: { status: "in_progress", createdAt: now, diagnosisId: null, completedAt: null },
    });
    if (takeover.count === 1) {
      return { kind: "new" };
    }
    // 他の実行が先に引き継いだ場合はin_progressとして扱う。
    return { kind: "in_progress" };
  }

  // status === "failed"(レート制限拒否・エラー等で解放済み) → 新規実行として引き継ぐ。
  const reset = await prisma.diagnosisIdempotencyLock.updateMany({
    where: { clientRequestId, status: existing.status },
    data: { status: "in_progress", createdAt: now, diagnosisId: null, completedAt: null },
  });
  if (reset.count === 1) {
    return { kind: "new" };
  }
  return acquireDiagnosisIdempotencyLock(clientRequestId, now);
}

export async function markDiagnosisIdempotencyLockCompleted(
  clientRequestId: string,
  diagnosisId: string
): Promise<void> {
  await prisma.diagnosisIdempotencyLock
    .update({
      where: { clientRequestId },
      data: { status: "completed", diagnosisId, completedAt: new Date() },
    })
    .catch((error) => {
      console.error(
        "[diagnosisIdempotencyRepository] mark completed failed:",
        error instanceof Error ? error.name : "UnknownError"
      );
    });
}

export async function markDiagnosisIdempotencyLockFailed(clientRequestId: string): Promise<void> {
  await prisma.diagnosisIdempotencyLock
    .update({ where: { clientRequestId }, data: { status: "failed" } })
    .catch((error) => {
      console.error(
        "[diagnosisIdempotencyRepository] mark failed failed:",
        error instanceof Error ? error.name : "UnknownError"
      );
    });
}
