-- AlterTable
ALTER TABLE "Contact" ADD COLUMN "lastLoginAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Invite" ADD COLUMN "pilotDurationDays" INTEGER;
