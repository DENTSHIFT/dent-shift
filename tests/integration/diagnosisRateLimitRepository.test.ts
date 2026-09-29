import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { applyPrismaMigrationsToTestDatabase } from "../helpers/testDatabase";

/**
 * DiagnosisRateLimitRepository / DiagnosisIdempotencyRepositoryの実DB(SQLite)結合
 * テスト(2026-09-29追加、PO指摘: 並列リクエスト・タイムアウト後の再送・古い処理による
 * ロック誤解除を実際のDBアクセスで検証する)。
 *
 * 既存tests/integration/diagnosisRepository.test.tsと同じパターン(使い捨てSQLite +
 * 動的import)を踏襲する。
 */

let testDbDir: string;
let rateLimitRepo: typeof import("@/server/db/diagnosisRateLimitRepository");
let idempotencyRepo: typeof import("@/server/db/diagnosisIdempotencyRepository");
let prisma: import("@prisma/client").PrismaClient;

/**
 * markDiagnosisIdempotencyLockCompletedInTransaction()はtxクライアント専用のため、
 * テストからは1ステップだけの$transactionでラップして呼ぶ(本番のroute.ts経路では
 * saveDiagnosisResultIfIdempotencyLockCurrent()がClinic/Diagnosis保存と同じ
 * トランザクションの中で呼ぶ)。
 */
async function markCompletedForTest(clientRequestId: string, executionId: string, diagnosisId: string) {
  await prisma.$transaction(async (tx) => {
    await idempotencyRepo.markDiagnosisIdempotencyLockCompletedInTransaction(
      tx,
      clientRequestId,
      executionId,
      diagnosisId
    );
  });
}

beforeAll(async () => {
  const testTmpRoot =
    process.platform === "darwin" ? realpathSync("/tmp") : realpathSync(tmpdir());
  testDbDir = mkdtempSync(path.join(testTmpRoot, "dent-shift-rate-limit-test-db-"));
  const testDbPath = path.join(testDbDir, "test.db");
  process.env.DATABASE_URL = `file:${testDbPath}`;

  applyPrismaMigrationsToTestDatabase(testDbPath);

  rateLimitRepo = await import("@/server/db/diagnosisRateLimitRepository");
  idempotencyRepo = await import("@/server/db/diagnosisIdempotencyRepository");
  const clientModule = await import("@/server/db/prismaClient");
  prisma = clientModule.prisma;
}, 60000);

afterAll(async () => {
  await prisma?.$disconnect();
  if (testDbDir) rmSync(testDbDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await prisma.diagnosisRateLimitState.deleteMany();
  await prisma.diagnosisIdempotencyLock.deleteMany();
});

describe("reserveDiagnosisSlot: 並列リクエストの排他制御", () => {
  it("同一スコープへ同時に10件リクエストしても、上限(maxRequests)を超えて許可されない(IPスコープは同時実行ロックの対象外、回数制限のみで抑制)", async () => {
    const scope = {
      scopeType: "ip" as const,
      scopeKey: "parallel-test-ip",
      windowMs: 60000,
      maxRequests: 3,
      enforceInFlightLock: false,
    };
    const results = await Promise.all(
      Array.from({ length: 10 }, () => rateLimitRepo.reserveDiagnosisSlot([scope]))
    );
    const allowedCount = results.filter((r) => r.allowed).length;
    expect(allowedCount).toBe(3);

    // 許可された分はすぐ解放しておく(後続テストへ影響させない)。
    await Promise.all(
      results
        .filter((r): r is { allowed: true; executionId: string } => r.allowed)
        .map((r) => rateLimitRepo.releaseDiagnosisSlot([scope], r.executionId))
    );
  });

  it("同時実行ロック(in_flight)は、同時に来た2件のうち1件だけを許可する", async () => {
    const scope = {
      scopeType: "clinic" as const,
      scopeKey: "parallel-clinic-1",
      windowMs: 60000,
      maxRequests: 100,
      enforceInFlightLock: true,
    };
    const [first, second] = await Promise.all([
      rateLimitRepo.reserveDiagnosisSlot([scope]),
      rateLimitRepo.reserveDiagnosisSlot([scope]),
    ]);
    const allowed = [first, second].filter((r) => r.allowed);
    const rejected = [first, second].filter((r) => !r.allowed);
    expect(allowed).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    if (!rejected[0]!.allowed) {
      expect(rejected[0]!.reason).toBe("in_flight");
    }
  });

  it("executionIdが一致しない解放は無視される(誤って他の実行のロックを解放しない)", async () => {
    const scope = {
      scopeType: "contact" as const,
      scopeKey: "exec-id-test",
      windowMs: 60000,
      maxRequests: 100,
      enforceInFlightLock: true,
    };
    const reserved = await rateLimitRepo.reserveDiagnosisSlot([scope]);
    expect(reserved.allowed).toBe(true);
    if (!reserved.allowed) return;

    // 別のexecutionIdで解放を試みても効果が無いこと。
    await rateLimitRepo.releaseDiagnosisSlot([scope], "not-the-real-execution-id");
    const stillLocked = await rateLimitRepo.reserveDiagnosisSlot([scope]);
    expect(stillLocked.allowed).toBe(false);
    if (!stillLocked.allowed) expect(stillLocked.reason).toBe("in_flight");

    // 正しいexecutionIdでの解放は成功し、次の予約が通ること。
    await rateLimitRepo.releaseDiagnosisSlot([scope], reserved.executionId);
    const afterRelease = await rateLimitRepo.reserveDiagnosisSlot([scope]);
    expect(afterRelease.allowed).toBe(true);
  });

  it("古い処理によるロック(inFlightSinceがTTLを超過)は、新しい実行が取得できる(ロック誤解除ではなく期限切れとしての正しい引き継ぎ)", async () => {
    const scope = {
      scopeType: "clinic" as const,
      scopeKey: "stale-lock-test",
      windowMs: 60000,
      maxRequests: 100,
      enforceInFlightLock: true,
    };
    const reserved = await rateLimitRepo.reserveDiagnosisSlot([scope]);
    expect(reserved.allowed).toBe(true);

    // サーバークラッシュ等で解放されなかった状態を模して、inFlightSinceを
    // TTLより過去へ直接書き換える(テスト専用の準備、アプリコードは経由しない)。
    await prisma.diagnosisRateLimitState.updateMany({
      where: { scopeType: scope.scopeType, scopeKey: scope.scopeKey },
      data: { inFlightSince: new Date(Date.now() - rateLimitRepo.DIAGNOSIS_INFLIGHT_LOCK_TTL_MS - 1000) },
    });

    const afterStale = await rateLimitRepo.reserveDiagnosisSlot([scope]);
    expect(afterStale.allowed).toBe(true);
  });

  it("全スコープのうち1つでも拒否ならDBへ何も反映しない(全条件を満たした場合だけ許可)", async () => {
    const okScope = {
      scopeType: "ip" as const,
      scopeKey: "combo-ok-ip",
      windowMs: 60000,
      maxRequests: 100,
      enforceInFlightLock: false,
    };
    const blockedScope = {
      scopeType: "clinic" as const,
      scopeKey: "combo-blocked-clinic",
      windowMs: 60000,
      maxRequests: 1,
      enforceInFlightLock: true,
    };

    // 先に1件消費してblockedScopeを上限へ。
    const first = await rateLimitRepo.reserveDiagnosisSlot([blockedScope]);
    expect(first.allowed).toBe(true);
    if (first.allowed) await rateLimitRepo.releaseDiagnosisSlot([blockedScope], first.executionId);

    const combined = await rateLimitRepo.reserveDiagnosisSlot([okScope, blockedScope]);
    expect(combined.allowed).toBe(false);

    // okScope側はcountInWindowが加算されていない(拒否時は全体を反映しない)ことを確認。
    // ensureRowExistsによりブックキーピング用の行(countInWindow=0)自体は作られるが、
    // 「実際の実行として消費された」ことにはならない。
    const okState = await prisma.diagnosisRateLimitState.findUnique({
      where: { scopeType_scopeKey: { scopeType: okScope.scopeType, scopeKey: okScope.scopeKey } },
    });
    expect(okState?.countInWindow).toBe(0);
  });
});

const PRINCIPAL_A = "contact:aaa";
const PRINCIPAL_B = "contact:bbb";
const INPUT_HASH_1 = "hash-1";
const INPUT_HASH_2 = "hash-2";

describe("acquireDiagnosisIdempotencyLock: タイムアウト後の再送で外部AIを再実行しない", () => {
  it("初回はnewを返し、進行中の同じclientRequestIdの再送はin_progressを返す(AI再実行させない)", async () => {
    const first = await idempotencyRepo.acquireDiagnosisIdempotencyLock("idem-test-1", PRINCIPAL_A, INPUT_HASH_1);
    expect(first.kind).toBe("new");

    const retryWhileInProgress = await idempotencyRepo.acquireDiagnosisIdempotencyLock(
      "idem-test-1",
      PRINCIPAL_A,
      INPUT_HASH_1
    );
    expect(retryWhileInProgress).toEqual({ kind: "in_progress" });
  });

  it("完了済みのclientRequestIdの再送は、同じdiagnosisIdをそのまま返す(AI再実行なし)", async () => {
    const created = await idempotencyRepo.acquireDiagnosisIdempotencyLock("idem-test-2", PRINCIPAL_A, INPUT_HASH_1);
    if (created.kind !== "new") throw new Error("expected new");
    await markCompletedForTest("idem-test-2", created.executionId, "diagnosis-abc");

    const retryAfterCompletion = await idempotencyRepo.acquireDiagnosisIdempotencyLock(
      "idem-test-2",
      PRINCIPAL_A,
      INPUT_HASH_1
    );
    expect(retryAfterCompletion).toEqual({ kind: "completed", diagnosisId: "diagnosis-abc" });
  });

  it("失敗(failed)扱いになったclientRequestIdは、再送時に新規実行として引き継がれる", async () => {
    const created = await idempotencyRepo.acquireDiagnosisIdempotencyLock("idem-test-3", PRINCIPAL_A, INPUT_HASH_1);
    if (created.kind !== "new") throw new Error("expected new");
    await idempotencyRepo.markDiagnosisIdempotencyLockFailed("idem-test-3", created.executionId);

    const retryAfterFailure = await idempotencyRepo.acquireDiagnosisIdempotencyLock(
      "idem-test-3",
      PRINCIPAL_A,
      INPUT_HASH_1
    );
    expect(retryAfterFailure.kind).toBe("new");
  });

  it("TTLを超えてin_progressのままの古いロックは、新しい実行が引き継ぐ(サーバークラッシュ等からの復旧)", async () => {
    const original = await idempotencyRepo.acquireDiagnosisIdempotencyLock(
      "idem-test-4",
      PRINCIPAL_A,
      INPUT_HASH_1
    );
    if (original.kind !== "new") throw new Error("expected new");
    await prisma.diagnosisIdempotencyLock.update({
      where: { clientRequestId: "idem-test-4" },
      data: {
        createdAt: new Date(Date.now() - 6 * 60 * 1000), // TTL(5分+30秒マージン)を超過
      },
    });

    const takenOver = await idempotencyRepo.acquireDiagnosisIdempotencyLock("idem-test-4", PRINCIPAL_A, INPUT_HASH_1);
    expect(takenOver.kind).toBe("new");
    if (takenOver.kind !== "new") throw new Error("expected new");
    expect(takenOver.executionId).not.toBe(original.executionId);

    // TTL経過後に引き継がれた古い実行(original.executionId)が、後になって遅れて
    // 完了/失敗を書き込もうとしても、新しい実行(takenOver)の状態を上書きしない。
    await markCompletedForTest("idem-test-4", original.executionId, "stale-diagnosis");
    const stateAfterStaleWrite = await prisma.diagnosisIdempotencyLock.findUnique({
      where: { clientRequestId: "idem-test-4" },
    });
    expect(stateAfterStaleWrite?.status).toBe("in_progress");
    expect(stateAfterStaleWrite?.diagnosisId).toBeNull();
    expect(stateAfterStaleWrite?.executionId).toBe(takenOver.executionId);
  });

  it("同時に同じclientRequestIdで10件到達しても、newは1件だけになる(二重送信・二重クリック対策)", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        idempotencyRepo.acquireDiagnosisIdempotencyLock("idem-test-parallel", PRINCIPAL_A, INPUT_HASH_1)
      )
    );
    const newCount = results.filter((r) => r.kind === "new").length;
    expect(newCount).toBe(1);
  });

  it("別の主体(別アカウント・別匿名IP)が同じclientRequestIdを使うとprincipal_mismatchを返し、diagnosisIdを返さない", async () => {
    const created = await idempotencyRepo.acquireDiagnosisIdempotencyLock(
      "idem-test-principal",
      PRINCIPAL_A,
      INPUT_HASH_1
    );
    if (created.kind !== "new") throw new Error("expected new");
    await markCompletedForTest("idem-test-principal", created.executionId, "diagnosis-should-not-leak");

    const fromOtherPrincipal = await idempotencyRepo.acquireDiagnosisIdempotencyLock(
      "idem-test-principal",
      PRINCIPAL_B,
      INPUT_HASH_1
    );
    expect(fromOtherPrincipal).toEqual({ kind: "principal_mismatch" });
  });

  it("同じ主体でも入力(inputHash)が異なる再送はinput_mismatchで拒否する", async () => {
    const created = await idempotencyRepo.acquireDiagnosisIdempotencyLock(
      "idem-test-input",
      PRINCIPAL_A,
      INPUT_HASH_1
    );
    expect(created.kind).toBe("new");

    const withDifferentInput = await idempotencyRepo.acquireDiagnosisIdempotencyLock(
      "idem-test-input",
      PRINCIPAL_A,
      INPUT_HASH_2
    );
    expect(withDifferentInput).toEqual({ kind: "input_mismatch" });
  });
});

describe("claimDiagnosisIdempotencyLockExecutionInTransaction: 重複診断保存の防止(PO指摘、2回目)", () => {
  it("引き継がれていない場合はtrueを返す(トランザクション内)", async () => {
    const created = await idempotencyRepo.acquireDiagnosisIdempotencyLock(
      "idem-test-current-1",
      PRINCIPAL_A,
      INPUT_HASH_1
    );
    if (created.kind !== "new") throw new Error("expected new");

    const claimed = await prisma.$transaction((tx) =>
      idempotencyRepo.claimDiagnosisIdempotencyLockExecutionInTransaction(
        tx,
        "idem-test-current-1",
        created.executionId
      )
    );
    expect(claimed).toBe(true);
  });

  it("TTL経過で別の実行に引き継がれた後は、古いexecutionIdに対してfalseを返す(トランザクション開始時点でロールバックの判断材料になる)", async () => {
    const original = await idempotencyRepo.acquireDiagnosisIdempotencyLock(
      "idem-test-current-2",
      PRINCIPAL_A,
      INPUT_HASH_1
    );
    if (original.kind !== "new") throw new Error("expected new");
    await prisma.diagnosisIdempotencyLock.update({
      where: { clientRequestId: "idem-test-current-2" },
      data: { createdAt: new Date(Date.now() - 6 * 60 * 1000) },
    });
    const takenOver = await idempotencyRepo.acquireDiagnosisIdempotencyLock(
      "idem-test-current-2",
      PRINCIPAL_A,
      INPUT_HASH_1
    );
    if (takenOver.kind !== "new") throw new Error("expected new");

    const staleClaim = await prisma.$transaction((tx) =>
      idempotencyRepo.claimDiagnosisIdempotencyLockExecutionInTransaction(
        tx,
        "idem-test-current-2",
        original.executionId
      )
    );
    expect(staleClaim).toBe(false);

    const currentClaim = await prisma.$transaction((tx) =>
      idempotencyRepo.claimDiagnosisIdempotencyLockExecutionInTransaction(
        tx,
        "idem-test-current-2",
        takenOver.executionId
      )
    );
    expect(currentClaim).toBe(true);
  });
});
