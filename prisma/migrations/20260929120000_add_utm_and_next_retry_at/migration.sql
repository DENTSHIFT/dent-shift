-- AlterTable
ALTER TABLE "Clinic" ADD COLUMN "utmSource" TEXT;
ALTER TABLE "Clinic" ADD COLUMN "utmMedium" TEXT;
ALTER TABLE "Clinic" ADD COLUMN "utmCampaign" TEXT;
ALTER TABLE "Clinic" ADD COLUMN "utmContent" TEXT;
ALTER TABLE "Clinic" ADD COLUMN "utmTerm" TEXT;

-- AlterTable
ALTER TABLE "IntegrationEvent" ADD COLUMN "nextRetryAt" DATETIME;
