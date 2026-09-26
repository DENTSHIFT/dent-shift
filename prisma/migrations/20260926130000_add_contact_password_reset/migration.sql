-- AlterTable
ALTER TABLE "Contact" ADD COLUMN "passwordResetTokenHash" TEXT;

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN "passwordResetExpiresAt" DATETIME;

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN "passwordResetEmailRequestedAt" DATETIME;

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN "passwordResetSmsSentAt" DATETIME;

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN "passwordResetSmsWindowStartedAt" DATETIME;

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN "passwordResetSmsSendCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN "passwordResetSmsAttemptCount" INTEGER NOT NULL DEFAULT 0;
