-- CreateTable
CREATE TABLE "Ambassador" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "referralCode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Ambassador_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attribution" (
    "id" TEXT NOT NULL,
    "ambassadorId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "referredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "Attribution_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Ambassador_email_key" ON "Ambassador"("email");
CREATE UNIQUE INDEX "Ambassador_referralCode_key" ON "Ambassador"("referralCode");
CREATE UNIQUE INDEX "Attribution_clinicId_key" ON "Attribution"("clinicId");
CREATE INDEX "Attribution_ambassadorId_idx" ON "Attribution"("ambassadorId");
CREATE INDEX "Attribution_status_idx" ON "Attribution"("status");

ALTER TABLE "Attribution" ADD CONSTRAINT "Attribution_ambassadorId_fkey" FOREIGN KEY ("ambassadorId") REFERENCES "Ambassador"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Attribution" ADD CONSTRAINT "Attribution_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
