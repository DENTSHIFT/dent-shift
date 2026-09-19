-- CreateTable
CREATE TABLE "Ambassador" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "referralCode" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Attribution" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ambassadorId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "referredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" DATETIME,
    CONSTRAINT "Attribution_ambassadorId_fkey" FOREIGN KEY ("ambassadorId") REFERENCES "Ambassador" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Attribution_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Ambassador_email_key" ON "Ambassador"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Ambassador_referralCode_key" ON "Ambassador"("referralCode");

-- CreateIndex
CREATE INDEX "Attribution_ambassadorId_idx" ON "Attribution"("ambassadorId");

-- CreateIndex
CREATE INDEX "Attribution_status_idx" ON "Attribution"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Attribution_clinicId_key" ON "Attribution"("clinicId");
