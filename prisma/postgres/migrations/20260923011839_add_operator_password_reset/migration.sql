-- AlterTable
ALTER TABLE "Operator" ADD COLUMN "passwordResetExpiresAt" TIMESTAMP(3);
ALTER TABLE "Operator" ADD COLUMN "passwordResetTokenHash" TEXT;
