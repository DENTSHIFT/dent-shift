-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Invite" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "inviteCode" TEXT NOT NULL,
    "clinicName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "specialPriceJpy" INTEGER NOT NULL DEFAULT 1,
    "durationMonths" INTEGER NOT NULL DEFAULT 3,
    "stripePriceId" TEXT NOT NULL,
    "startsAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME,
    "maxUses" INTEGER NOT NULL DEFAULT 1,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "usedAt" DATETIME,
    "usedByContactId" TEXT,
    "requireEmailMatch" BOOLEAN NOT NULL DEFAULT true,
    "campaign" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "isPilot" BOOLEAN NOT NULL DEFAULT false,
    "pilotDurationDays" INTEGER,
    "isLifetimeFree" BOOLEAN NOT NULL DEFAULT false,
    "createdByOperatorId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Invite_usedByContactId_fkey" FOREIGN KEY ("usedByContactId") REFERENCES "Contact" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Invite" ("campaign", "clinicName", "createdAt", "createdByOperatorId", "durationMonths", "email", "expiresAt", "id", "inviteCode", "isPilot", "maxUses", "pilotDurationDays", "requireEmailMatch", "specialPriceJpy", "startsAt", "status", "stripePriceId", "updatedAt", "usedAt", "usedByContactId", "usedCount") SELECT "campaign", "clinicName", "createdAt", "createdByOperatorId", "durationMonths", "email", "expiresAt", "id", "inviteCode", "isPilot", "maxUses", "pilotDurationDays", "requireEmailMatch", "specialPriceJpy", "startsAt", "status", "stripePriceId", "updatedAt", "usedAt", "usedByContactId", "usedCount" FROM "Invite";
DROP TABLE "Invite";
ALTER TABLE "new_Invite" RENAME TO "Invite";
CREATE UNIQUE INDEX "Invite_inviteCode_key" ON "Invite"("inviteCode");
CREATE INDEX "Invite_status_idx" ON "Invite"("status");
CREATE INDEX "Invite_email_idx" ON "Invite"("email");
CREATE TABLE "new_Subscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clinicId" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'trial',
    "externalSubscriptionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "statusEventAt" DATETIME,
    "trialStartedAt" DATETIME,
    "trialEndsAt" DATETIME,
    "paymentMethodStatus" TEXT,
    "inviteId" TEXT,
    "billingExempt" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Subscription_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Subscription_inviteId_fkey" FOREIGN KEY ("inviteId") REFERENCES "Invite" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Subscription" ("clinicId", "createdAt", "externalSubscriptionId", "id", "inviteId", "paymentMethodStatus", "plan", "status", "statusEventAt", "trialEndsAt", "trialStartedAt", "updatedAt") SELECT "clinicId", "createdAt", "externalSubscriptionId", "id", "inviteId", "paymentMethodStatus", "plan", "status", "statusEventAt", "trialEndsAt", "trialStartedAt", "updatedAt" FROM "Subscription";
DROP TABLE "Subscription";
ALTER TABLE "new_Subscription" RENAME TO "Subscription";
CREATE UNIQUE INDEX "Subscription_externalSubscriptionId_key" ON "Subscription"("externalSubscriptionId");
CREATE INDEX "Subscription_clinicId_idx" ON "Subscription"("clinicId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
