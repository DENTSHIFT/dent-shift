-- AlterTable
ALTER TABLE "Contact" ADD COLUMN "passwordResetTokenHash" TEXT;

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN "passwordResetExpiresAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN "passwordResetEmailRequestedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN "passwordResetSmsSentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN "passwordResetSmsWindowStartedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN "passwordResetSmsSendCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN "passwordResetSmsAttemptCount" INTEGER NOT NULL DEFAULT 0;
