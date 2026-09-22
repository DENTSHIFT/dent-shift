-- CreateTable
CREATE TABLE "Invite" (
    "id" TEXT NOT NULL,
    "inviteCode" TEXT NOT NULL,
    "clinicName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "specialPriceJpy" INTEGER NOT NULL DEFAULT 1,
    "durationMonths" INTEGER NOT NULL DEFAULT 3,
    "stripePriceId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "maxUses" INTEGER NOT NULL DEFAULT 1,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "usedAt" TIMESTAMP(3),
    "usedByContactId" TEXT,
    "requireEmailMatch" BOOLEAN NOT NULL DEFAULT true,
    "campaign" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdByOperatorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Invite_inviteCode_key" ON "Invite"("inviteCode");

-- CreateIndex
CREATE INDEX "Invite_status_idx" ON "Invite"("status");

-- CreateIndex
CREATE INDEX "Invite_email_idx" ON "Invite"("email");

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_usedByContactId_fkey" FOREIGN KEY ("usedByContactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN "inviteId" TEXT;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_inviteId_fkey" FOREIGN KEY ("inviteId") REFERENCES "Invite"("id") ON DELETE SET NULL ON UPDATE CASCADE;
