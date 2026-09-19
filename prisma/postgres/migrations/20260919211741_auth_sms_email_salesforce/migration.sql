-- AlterTable
ALTER TABLE "Contact" ADD COLUMN "phoneNumber" TEXT;
ALTER TABLE "Contact" ADD COLUMN "phoneVerifiedAt" TIMESTAMP(3);
ALTER TABLE "Contact" ADD COLUMN "smsStatus" TEXT;
ALTER TABLE "Contact" ADD COLUMN "smsSentAt" TIMESTAMP(3);
ALTER TABLE "Contact" ADD COLUMN "smsAttemptCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Contact" ADD COLUMN "smsResendCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Contact" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);
ALTER TABLE "Contact" ADD COLUMN "emailVerificationTokenHash" TEXT;
ALTER TABLE "Contact" ADD COLUMN "emailVerificationExpiresAt" TIMESTAMP(3);
ALTER TABLE "Contact" ADD COLUMN "registrationStep" TEXT NOT NULL DEFAULT 'profile';
ALTER TABLE "Contact" ADD COLUMN "consentAcceptedAt" TIMESTAMP(3);

CREATE INDEX "Contact_phoneNumber_idx" ON "Contact"("phoneNumber");

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN "trialStartedAt" TIMESTAMP(3);
ALTER TABLE "Subscription" ADD COLUMN "trialEndsAt" TIMESTAMP(3);
ALTER TABLE "Subscription" ADD COLUMN "paymentMethodStatus" TEXT;

-- CreateTable
CREATE TABLE "IntegrationEvent" (
    "id" TEXT NOT NULL,
    "externalId" TEXT,
    "eventType" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "contactId" TEXT,
    "clinicId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "IntegrationEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "IntegrationEvent_status_idx" ON "IntegrationEvent"("status");
CREATE INDEX "IntegrationEvent_createdAt_idx" ON "IntegrationEvent"("createdAt");
