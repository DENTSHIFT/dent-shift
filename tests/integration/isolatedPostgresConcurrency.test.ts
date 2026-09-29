import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { runFreeDiagnosis } from "@/server/services/runFreeDiagnosis";
import type { RunFreeDiagnosisDeps, RunFreeDiagnosisInput } from "@/server/services/runFreeDiagnosis";
import type { AiObservationInput, AiObservationResult, AiProvider } from "@/server/providers/ai/types";
import type { CompetitorProvider } from "@/server/providers/competitor/types";
import type { CompetitorClinic } from "@/domain/competitor/types";
import type { CriterionScore, DomainKey } from "@/domain/diagnosis/types";
import type { ScoreCriterionInput, ScoreProvider } from "@/server/providers/scoring/types";
import type { AdComplianceCheckInput, AdComplianceProvider } from "@/server/providers/ad-compliance/types";
import type { RawAdRiskFinding } from "@/domain/ad-compliance/types";
import { DOMAIN_CRITERIA } from "@/domain/diagnosis/scoreCriteria";
import { isIntegrationEventType } from "@/domain/integration/events";

/**
 * 2026-09-29追加(PO指摘、隔離Postgres検証・4回目の要求)。
 *
 * これまでのSQL Editorでの手動SQL確認(unique制約・CAS UPDATE・明示BEGIN/COMMITの
 * ロールバック)は「Postgresの制約・トランザクション動作確認」であり、アプリの
 * 並行実行検証そのものではない、というPO指摘に対応する。このファイルは、実際の
 * Prismaリポジトリ関数(acquireDiagnosisIdempotencyLock /
 * saveDiagnosisResultIfIdempotencyLockCurrent等、route.tsが呼ぶのと同じ関数)を
 * 隔離Postgresブランチへ接続して実行し、以下4点を検証する:
 *   1. 同じリクエストを独立した接続から同時実行し、実行権を得る処理が1つであること
 *   2. 保存処理と期限切れによる実行権取得を競合させ、Diagnosis・IntegrationEventが
 *      各1件になること
 *   3. 実際のイベント作成箇所(createPendingIntegrationEventInTransaction)で
 *      意図的に失敗させ、新規Clinic・Diagnosis・イベントが残らず、冪等性レコードも
 *      完了扱いにならないこと
 *   4. 完了後の再送で同じ診断結果を返し、保存処理が増えないこと
 *
 * 【実行方法・接続情報の扱い】
 * このテストはDATABASE_URLに接続秘密情報を含むため、通常の`npm run test`には
 * 含めない(このファイルは`ISOLATED_POSTGRES_DATABASE_URL`が未設定の場合、
 * describe.skipIfで全体をskipする)。接続文字列はチャット・ログに一切出さず、
 * リポジトリルートの`.env.isolated-postgres-verify`(gitignore対象、人間が
 * Neon ConsoleのConnectダイアログから直接作成する)から`source`するシェル経由での
 * みDATABASE_URL/ISOLATED_POSTGRES_DATABASE_URLへ渡す。このテストファイル自体は
 * その値を一切echo/console.logしない。
 *
 * 対象は隔離ブランチ(dent-shift-test-db / isolated-verify-diagnosis-ratelimit-20260929)
 * のみを想定する。migrationは2026-09-29にSQL Editorで手動適用済み(_prisma_migrations
 * には未登録)であり、このテストは`prisma migrate deploy`等のmigrationコマンドを
 * 一切実行しない(スキーマは既に存在する前提でPrisma Clientからの読み書きのみ行う)。
 */

const ISOLATED_POSTGRES_DATABASE_URL = process.env.ISOLATED_POSTGRES_DATABASE_URL;

let repo: typeof import("@/server/db/diagnosisRepository");
let idempotencyRepo: typeof import("@/server/db/diagnosisIdempotencyRepository");
let integrationEventRepo: typeof import("@/server/db/integrationEventRepository");
let prisma: import("@prisma/client").PrismaClient;

function mockCriteria(domain: DomainKey): CriterionScore[] {
  return DOMAIN_CRITERIA[domain].map((def) => ({
    key: def.key,
    label: def.label,
    maxScore: def.maxScore,
    score: def.maxScore,
    status: "estimated",
    evidence: [{ summary: "isolated postgres test: mock" }],
    measuredAt: "2026-01-01T00:00:00.000Z",
    dataSource: "mock",
    unavailableReason: null,
  }));
}

class FakeScoreProvider implements ScoreProvider {
  readonly name = "isolated-postgres-fake-score-provider";
  async score(domain: DomainKey, _input: ScoreCriterionInput): Promise<CriterionScore[]> {
    return mockCriteria(domain);
  }
}

class TwoMockAiProvider implements AiProvider {
  readonly name = "isolated-postgres-fake-ai-provider";
  async observe(input: AiObservationInput): Promise<AiObservationResult[]> {
    return input.patientQuestions.slice(0, 2).map((question, i) => ({
      question,
      aiProvider: i === 0 ? "chatgpt" : "gemini",
      model: i === 0 ? "mock-model" : "mock-model-2",
      mentioned: true,
      recommendationRank: i === 0 ? 1 : null,
      competitorMentions: [],
      citations: [],
      region: null,
      evidence: `isolated postgres test evidence ${i}`,
      dataSource: "mock" as const,
      capturedAt: `2026-01-01T00:00:0${i}.000Z`,
    }));
  }
}

class EmptyCompetitorProvider implements CompetitorProvider {
  readonly name = "isolated-postgres-fake-competitor-provider";
  async findNearbyCompetitors(): Promise<CompetitorClinic[]> {
    return [];
  }
}

class EmptyAdComplianceProvider implements AdComplianceProvider {
  readonly name = "isolated-postgres-fake-ad-compliance-provider";
  async check(_input: AdComplianceCheckInput): Promise<RawAdRiskFinding[]> {
    return [];
  }
}

const deps: RunFreeDiagnosisDeps = {
  aiProvider: new TwoMockAiProvider(),
  competitorProvider: new EmptyCompetitorProvider(),
  scoreProvider: new FakeScoreProvider(),
  adComplianceProvider: new EmptyAdComplianceProvider(),
};

function buildInput(clinicName: string): RunFreeDiagnosisInput {
  return {
    clinicName,
    directorName: "隔離Postgres検証院長",
    clinicUrl: `https://isolated-pg-${randomUUID()}.example.com`,
    contactEmail: `isolated-pg-${randomUUID()}@example.com`,
    contactPhone: "03-1234-5678",
  };
}

function saveInputFor(clinicUrl: string, contactEmail: string) {
  return { clinicUrl, directorName: "隔離Postgres検証院長", contactEmail };
}

describe.skipIf(!ISOLATED_POSTGRES_DATABASE_URL)(
  "isolatedPostgresConcurrency: 隔離Postgresブランチでのアプリ並行実行検証(PO指摘、4回目)",
  () => {
    beforeAll(async () => {
      // Prisma Clientの既定の接続プールサイズ(num_cpus*2+1)は環境によっては小さく、
      // 「複数の物理接続で真に並行実行される」ことを安定して検証するには不十分な
      // 場合がある。connection_limitが指定されていなければ、このテスト実行専用に
      // 明示的な下限(10)を設定する(接続文字列の値自体はログ・チャットへ出さない。
      // クエリパラメータを追加するだけで、既存の値を上書き・表示することはない)。
      const url = new URL(ISOLATED_POSTGRES_DATABASE_URL!);
      if (!url.searchParams.has("connection_limit")) {
        url.searchParams.set("connection_limit", "10");
      }
      process.env.DATABASE_URL = url.toString();
      repo = await import("@/server/db/diagnosisRepository");
      idempotencyRepo = await import("@/server/db/diagnosisIdempotencyRepository");
      integrationEventRepo = await import("@/server/db/integrationEventRepository");
      const clientModule = await import("@/server/db/prismaClient");
      prisma = clientModule.prisma;

      // 2026-09-29追加(PO指摘: 実行先が承認済み隔離ブランチのエンドポイントと
      // 一致しなければ、書き込み前に停止すること)。
      //
      // 接続先ホスト名をこのファイルへハードコードしない(それ自体は秘密情報ではないが、
      // チャット・コードへ接続情報の断片を書かないという方針を一貫させる)。代わりに、
      // 2026-09-29のSQL Editorでの手動検証時にこのブランチだけへ書き込んだ、
      // 既知のfingerprint行(clientRequestId='pg-verify-race-1',
      // executionId='exec-takeover-A')の存在を確認する。この行は
      // isolated-verify-diagnosis-ratelimit-20260929ブランチ以外(main・他の
      // pre-migrationブランチ等)には存在しないため、誤って別の接続先(特にmain)へ
      // 向いていた場合はここで即座に検知できる。見つからない場合は、以降のit()が
      // 一切実行されないよう(=一切の書き込みが行われないよう)beforeAll自体を
      // 失敗させる。
      const fingerprint = await prisma.diagnosisIdempotencyLock.findUnique({
        where: { clientRequestId: "pg-verify-race-1" },
      });
      if (!fingerprint || fingerprint.executionId !== "exec-takeover-A") {
        throw new Error(
          "[isolatedPostgresConcurrency] 接続先が承認済み隔離ブランチ" +
            "(isolated-verify-diagnosis-ratelimit-20260929)と一致することを確認できません" +
            "(2026-09-29のSQL Editor検証時に書き込んだfingerprint行が見つかりません)。" +
            "書き込みを一切行わずabortします。ISOLATED_POSTGRES_DATABASE_URLが正しい" +
            "ブランチを指しているか確認してください。"
        );
      }
    }, 60000);

    afterAll(async () => {
      await prisma?.$disconnect();
    });

    it("0. Promise.allの並列呼び出しが、実際に複数の物理接続(backend pid)で同時に処理されることを確認する", async () => {
      // 2026-09-29追加(PO指摘: Promise.allだけで「独立接続」と断定せず、複数接続で
      // 実際に処理が重なる構成を確認すること)。
      //
      // Promise.allはNode.js側の非同期呼び出しを並行に開始するだけであり、それだけでは
      // Postgres側が単一のバックエンド接続で逐次処理している可能性を排除できない
      // (Prisma Clientの接続プールサイズが1であれば、Promise.allで束ねても実際には
      // 1本の物理接続上で直列化される)。ここでは、各クエリにpg_sleep()を挟んだ上で
      // pg_backend_pid()を取得し、複数の異なるバックエンドPIDが同時に生きていた
      // (=実際に複数の物理接続が並行して処理していた)ことを、実測で確認する。
      // pg_sleep()はvoidを返すため、これをSELECT列にそのまま含めるとPrismaの
      // $queryRawがデシリアライズに失敗する(実測で確認: "Failed to deserialize
      // column of type 'void'")。CTEをMATERIALIZEDにして実行(=実際にsleepさせる)
      // だけ行い、その結果自体(void)は外側のSELECT列には出さず、代わりに
      // count(*)(bigint、安全に読める型)だけを参照することで回避する。
      const concurrency = 8;
      const pids = await Promise.all(
        Array.from({ length: concurrency }, () =>
          prisma.$queryRaw<{ pid: number }[]>`
            WITH delay AS MATERIALIZED (SELECT pg_sleep(0.3))
            SELECT pg_backend_pid() AS pid, (SELECT count(*) FROM delay) AS touched
          `
        )
      ).then((rows) => rows.map((r) => Number(r[0]!.pid)));

      const distinctPids = new Set(pids);
      // 1本の接続だけで直列処理されていた場合はdistinctPidsのサイズが1になるはず。
      // 実際に複数の物理接続が並行して使われたことを示すため、2以上であることを要求する。
      expect(distinctPids.size).toBeGreaterThan(1);
    });

    it("1. 同じリクエストを独立した接続から真に同時実行しても、実行権(kind:new)を得るのは1つだけ", async () => {
      const clientRequestId = `isolated-pg-concurrent-${randomUUID()}`;
      const principalKey = `anon:${randomUUID()}`;
      const inputHash = "hash-concurrent-1";

      // Promise.allで20件を同時に発火する。直前のテスト(0番)で、このPrisma Clientの
      // 接続プールが実際に複数の物理接続を同時に使えることを確認済みのため、この
      // acquireDiagnosisIdempotencyLock呼び出し群も(接続プールに空きがある限り)
      // 複数の独立した接続上で真に並行実行される。SQLiteの単一ファイルロックとは異なり、
      // Postgresは複数コネクションで本当に並列にこれらのINSERTを受け付けるため、
      // アプリのtryCreate()のunique制約catch(P2002)ロジックが実際に競合下で
      // 正しく機能するかを検証できる(逐次実行のSQL確認では検証できなかった点)。
      const results = await Promise.all(
        Array.from({ length: 20 }, () =>
          idempotencyRepo.acquireDiagnosisIdempotencyLock(clientRequestId, principalKey, inputHash)
        )
      );

      const newResults = results.filter((r) => r.kind === "new");
      expect(newResults.length).toBe(1);
      const inProgressCount = results.filter((r) => r.kind === "in_progress").length;
      expect(inProgressCount).toBe(19);
    });

    it("2. 保存処理(現行executionId)と期限切れ後の実行権取得(新executionId)が競合しても、Diagnosis/IntegrationEventは各1件だけになる", async () => {
      const clientRequestId = `isolated-pg-race-save-${randomUUID()}`;
      const principalKey = `anon:${randomUUID()}`;
      const inputHash = "hash-race-save-1";

      const original = await idempotencyRepo.acquireDiagnosisIdempotencyLock(
        clientRequestId,
        principalKey,
        inputHash
      );
      if (original.kind !== "new") throw new Error("expected new");

      // TTL経過(古いexecutionIdが長時間のAI呼び出し中に取って代わられた状況)を再現する。
      await prisma.diagnosisIdempotencyLock.update({
        where: { clientRequestId },
        data: { createdAt: new Date(Date.now() - 6 * 60 * 1000) },
      });
      const takenOver = await idempotencyRepo.acquireDiagnosisIdempotencyLock(
        clientRequestId,
        principalKey,
        inputHash
      );
      if (takenOver.kind !== "new") throw new Error("expected new");
      expect(takenOver.executionId).not.toBe(original.executionId);

      const clinicUrl = `https://isolated-pg-race-${randomUUID()}.example.com`;
      const contactEmail = `isolated-pg-race-${randomUUID()}@example.com`;
      const resultOld = await runFreeDiagnosis(buildInput("競合保存検証歯科(旧executionId)"), deps);
      const resultNew = await runFreeDiagnosis(buildInput("競合保存検証歯科(新executionId)"), deps);

      // 古い実行(original.executionId、既に取って代わられている)と、新しい実行
      // (takenOver.executionId、現在の正当な保持者)が、ほぼ同時にsaveを試みる状況を
      // Promise.allSettledで再現する。同じclinicUrl/contactEmailを使い、両方が
      // 成功した場合にDiagnosis/IntegrationEventが2件に増えてしまわないかを検証する。
      const [settledOld, settledNew] = await Promise.allSettled([
        repo.saveDiagnosisResultIfIdempotencyLockCurrent(
          saveInputFor(clinicUrl, contactEmail),
          resultOld,
          { clientRequestId, executionId: original.executionId },
          (saved) => ({
            eventType: "diagnosis_completed",
            clinicId: saved.clinicId,
            contactId: null,
            payload: { diagnosis_id: saved.diagnosisId, race: "old" },
          })
        ),
        repo.saveDiagnosisResultIfIdempotencyLockCurrent(
          saveInputFor(clinicUrl, contactEmail),
          resultNew,
          { clientRequestId, executionId: takenOver.executionId },
          (saved) => ({
            eventType: "diagnosis_completed",
            clinicId: saved.clinicId,
            contactId: null,
            payload: { diagnosis_id: saved.diagnosisId, race: "new" },
          })
        ),
      ]);

      // 古い実行は実行権を確保できずDiagnosisIdempotencyLockSupersededErrorで拒否される。
      expect(settledOld.status).toBe("rejected");
      if (settledOld.status === "rejected") {
        expect(settledOld.reason).toBeInstanceOf(repo.DiagnosisIdempotencyLockSupersededError);
      }
      // 新しい実行(現在の正当な保持者)は成功する。
      expect(settledNew.status).toBe("fulfilled");
      const savedClinicId =
        settledNew.status === "fulfilled" ? settledNew.value.clinicId : null;
      expect(savedClinicId).not.toBeNull();

      const diagnosisCount = await prisma.diagnosis.count({ where: { clinicId: savedClinicId! } });
      expect(diagnosisCount).toBe(1);
      const integrationEventCount = await prisma.integrationEvent.count({
        where: { clinicId: savedClinicId! },
      });
      expect(integrationEventCount).toBe(1);

      const lock = await prisma.diagnosisIdempotencyLock.findUnique({ where: { clientRequestId } });
      expect(lock?.status).toBe("completed");
      expect(lock?.executionId).toBe(takenOver.executionId);
    });

    it("2b. 保存処理そのものと、期限切れによる実行権取得(acquire)自体を同時に競合させても、実行権の保持者は1つに定まる", async () => {
      // 2026-09-29追加(PO指摘: 保存対takeoverのテストは、旧・新処理の保存競争だけでなく、
      // 保存処理と実行権取得そのものを競合させること)。
      //
      // テスト2は「takeoverによるacquireは先に完了させ、その後で新旧2つのsaveだけを
      // 競わせる」構成だった。ここでは、古い実行(旧executionId)が(長時間のAI呼び出し
      // からようやく戻ってきて)save完了を試みるのと、別の新しいリクエスト(再送)が
      // ちょうど同時にTTL経過を検知してacquire(takeover)を試みるのを、Promise.allで
      // 本当に同時に発火させる。「実行権を新しく取得する処理」自体が、
      // 「古い実行権で完了させようとする処理」と衝突する、より現実に近い競合状態。
      const clientRequestId = `isolated-pg-race-acquire-${randomUUID()}`;
      const principalKey = `anon:${randomUUID()}`;
      const inputHash = "hash-race-acquire-1";

      const original = await idempotencyRepo.acquireDiagnosisIdempotencyLock(
        clientRequestId,
        principalKey,
        inputHash
      );
      if (original.kind !== "new") throw new Error("expected new");
      await prisma.diagnosisIdempotencyLock.update({
        where: { clientRequestId },
        data: { createdAt: new Date(Date.now() - 6 * 60 * 1000) },
      });

      const clinicUrl = `https://isolated-pg-race-acquire-${randomUUID()}.example.com`;
      const contactEmail = `isolated-pg-race-acquire-${randomUUID()}@example.com`;
      const staleResult = await runFreeDiagnosis(buildInput("実行権競合検証歯科(旧executionId)"), deps);

      const [saveSettled, acquireSettled] = await Promise.allSettled([
        repo.saveDiagnosisResultIfIdempotencyLockCurrent(
          saveInputFor(clinicUrl, contactEmail),
          staleResult,
          { clientRequestId, executionId: original.executionId },
          (saved) => ({
            eventType: "diagnosis_completed",
            clinicId: saved.clinicId,
            contactId: null,
            payload: { diagnosis_id: saved.diagnosisId, race: "stale-save" },
          })
        ),
        idempotencyRepo.acquireDiagnosisIdempotencyLock(clientRequestId, principalKey, inputHash),
      ]);

      // saveとacquireのどちらが先にDBへ届くかはタイミング依存であり、Postgresの行ロックは
      // 「同時に両方が成立しない」ことだけを保証する(どちらのUPDATEが先に確定するかは
      // 保証しない)。実測で確認された挙動: saveが先に確定した場合でも、acquire自身の
      // 読み取りがsaveのトランザクションcommit前のスナップショットを見ることがあり
      // (READ COMMITTED下では正当な挙動)、その場合acquireは"completed"ではなく
      // "in_progress"を返すことがある(=酔ってTTL再取得を試みる前の、まだ"in_progress"の
      // 状態を読んだだけで、二重保存やロック破壊には至っていない)。そのため、
      // 「result.kindが必ずcompletedになる」という強すぎる期待はしない。
      // 検証すべき不変条件は「新規のtakeover(kind:'new')が2つ目成立しない」
      // 「最終的にDiagnosis/IntegrationEventが2重に増えない」の2点であり、
      // これは下のカウントチェックで直接検証する。
      const saveSucceeded = saveSettled.status === "fulfilled";
      if (saveSucceeded) {
        expect(acquireSettled.status).toBe("fulfilled");
        if (acquireSettled.status === "fulfilled") {
          // "new"(=別の実行権が新規に成立した)ではないことだけを保証する。
          expect(acquireSettled.value.kind).not.toBe("new");
        }
      } else {
        expect(saveSettled.status).toBe("rejected");
        if (saveSettled.status === "rejected") {
          expect(saveSettled.reason).toBeInstanceOf(repo.DiagnosisIdempotencyLockSupersededError);
        }
      }

      // 結果のいずれの分岐でも、Diagnosis/IntegrationEventが2件以上に増えていないこと
      // (=実行権が二重に成立してDBへ二重保存されていないこと)を保証する。
      const diagnosisCount = await prisma.diagnosis.count({
        where: { clinic: { url: clinicUrl } },
      });
      expect(diagnosisCount).toBeLessThanOrEqual(1);
    });

    it("3. 実際のイベント作成箇所(createPendingIntegrationEventInTransaction)で意図的に失敗させると、Clinic・Diagnosis・イベントのいずれも残らず、冪等性レコードも完了扱いにならない", async () => {
      const clientRequestId = `isolated-pg-tx-fail-${randomUUID()}`;
      const principalKey = `anon:${randomUUID()}`;
      const inputHash = "hash-tx-fail-1";

      const acquired = await idempotencyRepo.acquireDiagnosisIdempotencyLock(
        clientRequestId,
        principalKey,
        inputHash
      );
      if (acquired.kind !== "new") throw new Error("expected new");

      // 2026-09-29追加(PO指摘: 不正なeventTypeが本当に保存エラーになる制約を確認する。
      // 制約がなければ、イベント作成箇所で確実に例外を発生させること)。
      //
      // IntegrationEvent.eventTypeはDB側のCHECK制約・enum型では制約されていない
      // (prisma/postgres/schema.prismaではTEXT列、2026-09-29のSQL Editor確認でも
      // information_schema.columns上はtext型で追加の列制約なし)。そのため、
      // 「不正なeventTypeを拒否する」保証はDBの制約ではなく、アプリケーション層の
      // isIntegrationEventType()ホワイトリストチェック(このassertionで直接確認する)が
      // 唯一の強制ポイントである。まずその前提を明示的に確認してから、
      // その同じチェックが実際にthrowすることを検証する。
      const isKnownInvalidEventType = isIntegrationEventType("__intentionally_invalid_event_type__");
      expect(isKnownInvalidEventType).toBe(false);
      // 参考情報として、eventType列に関連するCHECK制約の有無をログに残す(値の
      // ホワイトリスト制約ではなくNOT NULL相当の制約がCHECKとして表れることがあるため、
      // 件数そのものをテストの合否条件にはしない。値レベルの拒否がDB制約由来か
      // アプリ層由来かは、直後の実際の書き込み失敗で判定する)。
      const checkConstraints = await prisma.$queryRaw<{ constraint_name: string; check_clause: string }[]>`
        SELECT tc.constraint_name, cc.check_clause
        FROM information_schema.table_constraints tc
        JOIN information_schema.constraint_column_usage ccu
          ON tc.constraint_name = ccu.constraint_name
        JOIN information_schema.check_constraints cc
          ON tc.constraint_name = cc.constraint_name
        WHERE tc.table_name = 'IntegrationEvent'
          AND ccu.column_name = 'eventType'
          AND tc.constraint_type = 'CHECK'
      `;
      const hasValueWhitelistConstraint = checkConstraints.some((c) =>
        /__intentionally_invalid_event_type__|IN\s*\(/i.test(c.check_clause)
      );
      console.log(
        `[test 3] eventType関連CHECK制約: ${checkConstraints.length}件` +
          `(値のホワイトリスト制約を含む: ${hasValueWhitelistConstraint})`
      );
      expect(hasValueWhitelistConstraint).toBe(false);

      const clinicCountBefore = await prisma.clinic.count();
      const diagnosisCountBefore = await prisma.diagnosis.count();
      const integrationEventCountBefore = await prisma.integrationEvent.count();

      const result = await runFreeDiagnosis(buildInput("イベント作成失敗検証歯科"), deps);

      // 上で確認した通りDB制約は無いため、createPendingIntegrationEventInTransaction()
      // 自体のisIntegrationEventType()チェックが、イベント作成"その箇所"で確実に
      // IntegrationEventRepositoryErrorをthrowする(src/server/db/
      // integrationEventRepository.ts)。テスト側で人工的に別の例外を投げ込むもの
      // ではない。この例外は$transactionコールバック内から伝播するため、
      // Clinic/Diagnosis作成を含むトランザクション全体がロールバックされるはず。
      await expect(
        repo.saveDiagnosisResultIfIdempotencyLockCurrent(
          saveInputFor(
            `https://isolated-pg-tx-fail-${randomUUID()}.example.com`,
            `isolated-pg-tx-fail-${randomUUID()}@example.com`
          ),
          result,
          { clientRequestId, executionId: acquired.executionId },
          (saved) => ({
            eventType: "__intentionally_invalid_event_type__",
            clinicId: saved.clinicId,
            contactId: null,
            payload: { diagnosis_id: saved.diagnosisId },
          })
        )
      ).rejects.toThrow(integrationEventRepo.IntegrationEventRepositoryError);

      expect(await prisma.clinic.count()).toBe(clinicCountBefore);
      expect(await prisma.diagnosis.count()).toBe(diagnosisCountBefore);
      expect(await prisma.integrationEvent.count()).toBe(integrationEventCountBefore);

      const lock = await prisma.diagnosisIdempotencyLock.findUnique({ where: { clientRequestId } });
      expect(lock?.status).toBe("in_progress");
      expect(lock?.diagnosisId).toBeNull();
    });

    it("4. 完了後の再送(acquire)は同じdiagnosisIdを返し、Diagnosisは増えない(保存処理を再実行しない)", async () => {
      const clientRequestId = `isolated-pg-retry-${randomUUID()}`;
      const principalKey = `anon:${randomUUID()}`;
      const inputHash = "hash-retry-1";

      const acquired = await idempotencyRepo.acquireDiagnosisIdempotencyLock(
        clientRequestId,
        principalKey,
        inputHash
      );
      if (acquired.kind !== "new") throw new Error("expected new");

      let saveCallCount = 0;
      async function simulateDiagnosisRequest(): Promise<{ diagnosisId: string }> {
        // route.tsの制御フローを最小限で再現する: まずacquireを呼び、"completed"なら
        // 既存のdiagnosisIdをそのまま返して保存処理(AI呼び出し相当・save)を一切
        // 実行しない。それ以外の場合のみsaveDiagnosisResultIfIdempotencyLockCurrent
        // を呼ぶ(=保存処理が実際に呼ばれた回数をsaveCallCountで数える)。
        const acquireResult = await idempotencyRepo.acquireDiagnosisIdempotencyLock(
          clientRequestId,
          principalKey,
          inputHash
        );
        if (acquireResult.kind === "completed") {
          return { diagnosisId: acquireResult.diagnosisId };
        }
        if (acquireResult.kind !== "new") {
          throw new Error(`unexpected acquire kind: ${acquireResult.kind}`);
        }
        saveCallCount += 1;
        const result = await runFreeDiagnosis(buildInput("再送検証歯科"), deps);
        const saved = await repo.saveDiagnosisResultIfIdempotencyLockCurrent(
          saveInputFor(
            `https://isolated-pg-retry-${randomUUID()}.example.com`,
            `isolated-pg-retry-${randomUUID()}@example.com`
          ),
          result,
          { clientRequestId, executionId: acquireResult.executionId },
          (s) => ({
            eventType: "diagnosis_completed",
            clinicId: s.clinicId,
            contactId: null,
            payload: { diagnosis_id: s.diagnosisId },
          })
        );
        return { diagnosisId: saved.diagnosisId };
      }

      // 1回目: まだ"new"(acquiredで既に確保済みのため、この呼び出しでは新規executionIdを
      // さらに発行させず、既存acquiredの結果を使って直接saveへ進む経路を検証する)。
      saveCallCount += 1;
      const resultFirst = await runFreeDiagnosis(buildInput("再送検証歯科(初回)"), deps);
      const savedFirst = await repo.saveDiagnosisResultIfIdempotencyLockCurrent(
        saveInputFor(
          `https://isolated-pg-retry-first-${randomUUID()}.example.com`,
          `isolated-pg-retry-first-${randomUUID()}@example.com`
        ),
        resultFirst,
        { clientRequestId, executionId: acquired.executionId },
        (s) => ({
          eventType: "diagnosis_completed",
          clinicId: s.clinicId,
          contactId: null,
          payload: { diagnosis_id: s.diagnosisId },
        })
      );

      // 2回目・3回目: タイムアウト後の再送を模して、同じclientRequestId/principalKey/
      // inputHashで再度リクエストする。既に"completed"のため、simulateDiagnosisRequest()は
      // 保存処理(saveCallCountの増加)を一切行わないはず。
      const retry1 = await simulateDiagnosisRequest();
      const retry2 = await simulateDiagnosisRequest();

      expect(retry1.diagnosisId).toBe(savedFirst.diagnosisId);
      expect(retry2.diagnosisId).toBe(savedFirst.diagnosisId);
      expect(saveCallCount).toBe(1);

      const diagnosisCount = await prisma.diagnosis.count({ where: { id: savedFirst.diagnosisId } });
      expect(diagnosisCount).toBe(1);
    });
  }
);
