-- AlterTable
ALTER TABLE "Operator" ADD COLUMN "passwordResetExpiresAt" DATETIME;
ALTER TABLE "Operator" ADD COLUMN "passwordResetTokenHash" TEXT;
