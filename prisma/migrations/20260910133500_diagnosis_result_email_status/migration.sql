ALTER TABLE "Diagnosis" ADD COLUMN "resultEmailStatus" TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE "Diagnosis" ADD COLUMN "resultEmailSentAt" DATETIME;
