-- AlterTable
ALTER TABLE "Clinic" ADD COLUMN "trialConsumedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "TrialEntitlement" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'reserved',
    "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reservationExpiresAt" TIMESTAMP(3) NOT NULL,
    "checkoutSessionId" TEXT,
    "externalSubscriptionId" TEXT,
    "consumedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrialEntitlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrialEntitlement_checkoutSessionId_key" ON "TrialEntitlement"("checkoutSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "TrialEntitlement_externalSubscriptionId_key" ON "TrialEntitlement"("externalSubscriptionId");

-- CreateIndex
CREATE INDEX "TrialEntitlement_clinicId_idx" ON "TrialEntitlement"("clinicId");

-- AddForeignKey
ALTER TABLE "TrialEntitlement" ADD CONSTRAINT "TrialEntitlement_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 2026-09-27追加(PO承認、P0): statusを自由文字列にせず、CHECK制約で3値に限定する
-- (Prisma純正enumはSQLite側でDBレベルの制約を持てないため採用せず、Postgres側にだけ
-- 追加の防御としてCHECK制約を設ける。アプリ側はTypeScriptの検証関数と単一の遷移関数
-- <reserved→consumed、reserved→released>で制御し、ここはその最終防衛線)。
ALTER TABLE "TrialEntitlement" ADD CONSTRAINT "TrialEntitlement_status_check"
  CHECK ("status" IN ('reserved', 'consumed', 'released'));

-- 2026-09-27追加(PO承認、P0): 医院1件につき、同時に有効な("reserved"状態の)予約は
-- 1件だけであることをDBレベルで保証する部分ユニークインデックス。
CREATE UNIQUE INDEX "TrialEntitlement_one_active_reservation_per_clinic"
  ON "TrialEntitlement" ("clinicId")
  WHERE "status" = 'reserved';
