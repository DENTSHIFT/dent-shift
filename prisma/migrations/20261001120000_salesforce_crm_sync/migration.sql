-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN "currentPeriodEnd" DATETIME;
ALTER TABLE "Subscription" ADD COLUMN "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Subscription" ADD COLUMN "cancelAt" DATETIME;
ALTER TABLE "Subscription" ADD COLUMN "canceledAt" DATETIME;
ALTER TABLE "Subscription" ADD COLUMN "endedAt" DATETIME;
ALTER TABLE "Subscription" ADD COLUMN "detailsEventAt" DATETIME;
ALTER TABLE "Subscription" ADD COLUMN "firstActivatedAt" DATETIME;

-- AlterTable
ALTER TABLE "IntegrationEvent" ADD COLUMN "alertedAt" DATETIME;

-- CreateTable
CREATE TABLE "CrmSyncLock" (
    "clinicId" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "lockedUntil" DATETIME NOT NULL
);

-- Backfill firstActivatedAt (受注実績): Stripe契約(Pilot/永久無料を除く)のうち現在activeのものと、
-- 過去にactiveへ遷移した記録(subscription_activated)がある契約。
UPDATE "Subscription" SET "firstActivatedAt" = COALESCE("statusEventAt", "createdAt")
WHERE "status" = 'active' AND "firstActivatedAt" IS NULL
  AND "externalSubscriptionId" IS NOT NULL AND "externalSubscriptionId" NOT LIKE 'pilot_%'
  AND "billingExempt" = false;
UPDATE "Subscription" SET "firstActivatedAt" = (
  SELECT MIN(ie."createdAt") FROM "IntegrationEvent" ie
  WHERE ie."dedupeKey" = 'subscription_activated:' || "Subscription"."externalSubscriptionId"
)
WHERE "firstActivatedAt" IS NULL AND "externalSubscriptionId" IS NOT NULL AND EXISTS (
  SELECT 1 FROM "IntegrationEvent" ie
  WHERE ie."dedupeKey" = 'subscription_activated:' || "Subscription"."externalSubscriptionId"
);

-- CreateTable
CREATE TABLE "ConsultationBooking" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "timerexEventId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "clinicId" TEXT,
    "contactId" TEXT,
    "matchMethod" TEXT NOT NULL,
    "startAt" DATETIME NOT NULL,
    "endAt" DATETIME NOT NULL,
    "bookedAt" DATETIME,
    "canceledAt" DATETIME,
    "calendarName" TEXT,
    "hostName" TEXT,
    "lastWebhookType" TEXT NOT NULL,
    "lastWebhookAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "ConsultationBooking_timerexEventId_key" ON "ConsultationBooking"("timerexEventId");

-- CreateIndex
CREATE INDEX "ConsultationBooking_clinicId_idx" ON "ConsultationBooking"("clinicId");
