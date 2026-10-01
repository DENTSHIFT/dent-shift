import "server-only";
import { prisma } from "@/server/db/prismaClient";

// 医院単位のSalesforce同期ロック(リース方式)。同じ医院の同期を同時に1つだけにし、
// 「古いスナップショットを読んだ同期が最後に書き込んで新しい値を上書きする」競合を防ぐ。
// スナップショットはロック取得後に読むため、ロックを順番に取った同期ほど新しいDB状態を送る。
//
// リース期限はSalesforceへの1リクエストの最大所要時間(タイムアウト10秒、401時の再取得込みでも
// 1分未満)より十分長くする。書き込みの直前に毎回renewし、他者に奪われていたら書き込まずに中断する。
export const CRM_SYNC_LOCK_LEASE_MS = 3 * 60 * 1000;

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "P2002";
}

/** ロックを取得できればtrue。他の同期が有効なリースを保持していればfalse。 */
export async function acquireCrmSyncLock(clinicId: string, ownerId: string, now: Date = new Date()): Promise<boolean> {
  const lockedUntil = new Date(now.getTime() + CRM_SYNC_LOCK_LEASE_MS);
  try {
    await prisma.crmSyncLock.create({ data: { clinicId, ownerId, lockedUntil } });
    return true;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
  }
  // 期限切れのリース(異常終了した同期の残骸)だけを引き継ぐ。条件付き更新なので取り合いでも1者だけが勝つ。
  const taken = await prisma.crmSyncLock.updateMany({
    where: { clinicId, lockedUntil: { lt: now } },
    data: { ownerId, lockedUntil },
  });
  return taken.count === 1;
}

/** まだ自分がロックを保持していればリースを延長してtrue。奪われていればfalse(書き込みを中断する)。 */
export async function renewCrmSyncLock(clinicId: string, ownerId: string, now: Date = new Date()): Promise<boolean> {
  const renewed = await prisma.crmSyncLock.updateMany({
    where: { clinicId, ownerId },
    data: { lockedUntil: new Date(now.getTime() + CRM_SYNC_LOCK_LEASE_MS) },
  });
  return renewed.count === 1;
}

/** 自分が保持しているロックだけを解放する(他者が引き継いだロックは消さない)。 */
export async function releaseCrmSyncLock(clinicId: string, ownerId: string): Promise<void> {
  await prisma.crmSyncLock.deleteMany({ where: { clinicId, ownerId } });
}
