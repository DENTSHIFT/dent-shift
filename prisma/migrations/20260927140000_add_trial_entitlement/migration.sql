-- AlterTable
ALTER TABLE "Clinic" ADD COLUMN "trialConsumedAt" DATETIME;

-- CreateTable
CREATE TABLE "TrialEntitlement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clinicId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'reserved',
    "reservedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reservationExpiresAt" DATETIME NOT NULL,
    "checkoutSessionId" TEXT,
    "externalSubscriptionId" TEXT,
    "consumedAt" DATETIME,
    "releasedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TrialEntitlement_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "TrialEntitlement_checkoutSessionId_key" ON "TrialEntitlement"("checkoutSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "TrialEntitlement_externalSubscriptionId_key" ON "TrialEntitlement"("externalSubscriptionId");

-- CreateIndex
CREATE INDEX "TrialEntitlement_clinicId_idx" ON "TrialEntitlement"("clinicId");

-- 2026-09-27追加(PO承認、P0): 医院1件につき、同時に有効な("reserved"状態の)予約は
-- 1件だけであることをDBレベルで保証する部分ユニークインデックス。SQLiteも部分
-- インデックス(WHERE句付きのCREATE UNIQUE INDEX)をサポートする。
CREATE UNIQUE INDEX "TrialEntitlement_one_active_reservation_per_clinic"
  ON "TrialEntitlement" ("clinicId")
  WHERE "status" = 'reserved';
