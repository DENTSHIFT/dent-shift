/**
 * Salesforce初回接続時の遡及同期(要件確認書11章)。
 *
 * 既定はドライラン: DBを読むだけで、Salesforceへは一切接続しない。対象医院数・イベント種別ごとの
 * 件数・期間・想定API呼び出し数(概算)を表示する。個人情報(医院名・メール等)は出力しない。
 *
 * 実行(--execute)は承認後に限る。医院単位で処理する:
 *   1. 医院ごとに最新の未同期イベントを1件同期する(同期内容は「その時点のDBの確定状態」なので、
 *      同じ医院の古い未同期イベントの内容も含まれる)。
 *   2. 成功した医院の、同期開始より前に作られた残りの未同期イベントをsyncedにする(重複送信しない)。
 * 停止条件: 接続先組織の不一致・認証失敗(即停止) / 連続失敗が--max-consecutive-failures件に到達。
 *
 * 使い方:
 *   npx tsx --conditions=react-server scripts/salesforce-initial-sync.ts [--since 2026-09-01] [--event-types a,b]
 *   npx tsx --conditions=react-server scripts/salesforce-initial-sync.ts --execute --max-clinics 20 [--delay-ms 1000]
 */
import { prisma } from "@/server/db/prismaClient";
import { resolveSalesforceConfigFromProcessEnv } from "@/server/config/salesforceConfig";
import { MAX_RETRY_COUNT, isConnectionLevelError, syncIntegrationEvent } from "@/server/services/salesforceSync";
import { resolveSalesforceSyncClinicAllowlistFromProcessEnv } from "@/server/config/salesforceSyncAllowlist";

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const execute = process.argv.includes("--execute");
const since = argValue("--since") ? new Date(`${argValue("--since")}T00:00:00+09:00`) : null;
const eventTypes = argValue("--event-types")?.split(",").map((t) => t.trim()).filter(Boolean) ?? null;
const maxClinics = Number(argValue("--max-clinics") ?? "20");
const delayMs = Number(argValue("--delay-ms") ?? "1000");
const maxConsecutiveFailures = Number(argValue("--max-consecutive-failures") ?? "3");

// 1医院あたりの想定API呼び出し(Lead取得+Lead/Account/Contact/商談/診断/相談のupsert)の概算。
const ESTIMATED_CALLS_PER_CLINIC = 8;

async function main() {
  // 2026-10-03: 段階的同期ガード(SALESFORCE_SYNC_CLINIC_ALLOWLIST)。未設定/空/不正なら対象0件。
  // 実行時の送信判定はsyncIntegrationEvent側でも行われる(許可外は"held"、API呼び出しなし)。
  const allowlist = resolveSalesforceSyncClinicAllowlistFromProcessEnv();
  console.log(`clinic allowlist: ${allowlist.mode === "list" ? `${allowlist.clinicIds.size} clinic(s)` : allowlist.mode}`);
  if (allowlist.mode === "none") {
    console.error("SALESFORCE_SYNC_CLINIC_ALLOWLIST が未設定・空・不正のため対象0件(全件停止)。");
    return;
  }
  const where = {
    status: { in: ["pending", "failed"] },
    retryCount: { lt: MAX_RETRY_COUNT },
    clinicId: allowlist.mode === "list" ? { in: [...allowlist.clinicIds] } : { not: null },
    ...(since ? { createdAt: { gte: since } } : {}),
    ...(eventTypes ? { eventType: { in: eventTypes } } : {}),
  };
  const events = await prisma.integrationEvent.findMany({
    where,
    orderBy: { createdAt: "asc" },
    select: { id: true, clinicId: true, eventType: true, createdAt: true },
  });
  const withoutClinic = await prisma.integrationEvent.count({
    where: { status: { in: ["pending", "failed"] }, clinicId: null },
  });
  const exhausted = await prisma.integrationEvent.count({
    where: { status: "failed", retryCount: { gte: MAX_RETRY_COUNT } },
  });

  const byType = new Map<string, number>();
  const latestByClinic = new Map<string, { id: string; createdAt: Date }>();
  for (const event of events) {
    byType.set(event.eventType, (byType.get(event.eventType) ?? 0) + 1);
    latestByClinic.set(event.clinicId!, { id: event.id, createdAt: event.createdAt });
  }

  console.log(`mode: ${execute ? "EXECUTE" : "dry-run (Salesforceへは接続しません)"}`);
  console.log(`target events: ${events.length} / clinics: ${latestByClinic.size}`);
  console.log(`period: ${events[0]?.createdAt.toISOString() ?? "-"} .. ${events.at(-1)?.createdAt.toISOString() ?? "-"}`);
  console.log("by event type:", Object.fromEntries([...byType.entries()].sort()));
  console.log(`estimated API calls: ~${latestByClinic.size * ESTIMATED_CALLS_PER_CLINIC}`);
  console.log(`excluded: no clinic id=${withoutClinic}, retry exhausted=${exhausted} (運用画面で個別確認)`);

  if (!execute) return;

  const config = resolveSalesforceConfigFromProcessEnv();
  if (config.provider === "disabled") {
    console.error("SALESFORCE_PROVIDER=disabled のため実行しません。");
    process.exitCode = 1;
    return;
  }

  let processed = 0;
  let consecutiveFailures = 0;
  for (const [clinicId, latest] of latestByClinic) {
    if (processed >= maxClinics) break;
    processed += 1;
    const startedAt = new Date();
    try {
      const outcome = await syncIntegrationEvent(latest.id);
      if (outcome === "synced") {
        consecutiveFailures = 0;
        const covered = await prisma.integrationEvent.updateMany({
          where: { ...where, clinicId, createdAt: { lte: latest.createdAt }, id: { not: latest.id } },
          data: { status: "synced", processedAt: startedAt, lastAttemptedAt: startedAt, nextRetryAt: null },
        });
        console.log(`[${processed}] synced (covered ${covered.count} older events)`);
      } else {
        consecutiveFailures += outcome === "failed" ? 1 : 0;
        console.log(`[${processed}] ${outcome}`);
      }
    } catch (error) {
      consecutiveFailures += 1;
      console.error(`[${processed}] error: ${error instanceof Error ? error.message : "unknown"}`);
      if (isConnectionLevelError(error)) {
        console.error("接続先組織の不一致または認証失敗のため停止します。");
        process.exitCode = 1;
        return;
      }
    }
    if (consecutiveFailures >= maxConsecutiveFailures) {
      console.error(`連続${consecutiveFailures}件失敗したため停止します(運用画面でエラー内容を確認してください)。`);
      process.exitCode = 1;
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  console.log(`done: processed ${processed} clinics (remaining ${Math.max(0, latestByClinic.size - processed)})`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
