-- AlterTable
ALTER TABLE "Invite" ADD COLUMN "isLifetimeFree" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN "billingExempt" BOOLEAN NOT NULL DEFAULT false;
