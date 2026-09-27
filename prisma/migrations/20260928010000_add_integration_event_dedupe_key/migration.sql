-- AlterTable
ALTER TABLE "IntegrationEvent" ADD COLUMN "dedupeKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationEvent_dedupeKey_key" ON "IntegrationEvent"("dedupeKey");
