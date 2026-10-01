-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN "currentPeriodEnd" TIMESTAMP(3);
ALTER TABLE "Subscription" ADD COLUMN "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Subscription" ADD COLUMN "cancelAt" TIMESTAMP(3);
ALTER TABLE "Subscription" ADD COLUMN "canceledAt" TIMESTAMP(3);
ALTER TABLE "Subscription" ADD COLUMN "endedAt" TIMESTAMP(3);
ALTER TABLE "Subscription" ADD COLUMN "detailsEventAt" TIMESTAMP(3);
ALTER TABLE "Subscription" ADD COLUMN "firstActivatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "IntegrationEvent" ADD COLUMN "alertedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CrmSyncLock" (
    "clinicId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "lockedUntil" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmSyncLock_pkey" PRIMARY KEY ("clinicId")
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
    "id" TEXT NOT NULL,
    "timerexEventId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "clinicId" TEXT,
    "contactId" TEXT,
    "matchMethod" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "bookedAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "calendarName" TEXT,
    "hostName" TEXT,
    "lastWebhookType" TEXT NOT NULL,
    "lastWebhookAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConsultationBooking_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConsultationBooking_timerexEventId_key" ON "ConsultationBooking"("timerexEventId");

-- CreateIndex
CREATE INDEX "ConsultationBooking_clinicId_idx" ON "ConsultationBooking"("clinicId");
