-- DENT SHIFT test/production PostgreSQL baseline.
-- Local SQLite migrations remain under prisma/migrations and are not applied here.

CREATE TABLE "Clinic" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "contactEmail" TEXT,
    "gbpUrl" TEXT,
    "bookingUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Clinic_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Diagnosis" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "totalPoints" INTEGER NOT NULL,
    "totalStatus" TEXT NOT NULL,
    "scoreBreakdownJson" TEXT NOT NULL,
    "competitorsJson" TEXT NOT NULL,
    "questionResultsJson" TEXT NOT NULL,
    "improvementTasksJson" TEXT NOT NULL,
    "dataDisclaimer" TEXT NOT NULL,
    "measuredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "adComplianceChecksJson" TEXT NOT NULL DEFAULT '{"findings":[],"disclaimer":"","checkedAt":""}',
    "isSample" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Diagnosis_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiObservation" (
    "id" TEXT NOT NULL,
    "diagnosisId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientQuestion" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "mention" BOOLEAN,
    "rank" INTEGER,
    "citationsJson" TEXT,
    "competitorsJson" TEXT,
    "region" TEXT,
    "measurementAt" TIMESTAMP(3) NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "evidence" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "measurementStatus" TEXT NOT NULL,
    "unavailableReason" TEXT,
    "measurementMetaJson" TEXT,
    "provisional" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiObservation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'owner',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Session" (
    "token" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("token")
);

CREATE INDEX "AiObservation_diagnosisId_idx" ON "AiObservation"("diagnosisId");
CREATE INDEX "AiObservation_clinicId_idx" ON "AiObservation"("clinicId");
CREATE UNIQUE INDEX "Contact_email_key" ON "Contact"("email");

ALTER TABLE "Diagnosis"
ADD CONSTRAINT "Diagnosis_clinicId_fkey"
FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AiObservation"
ADD CONSTRAINT "AiObservation_diagnosisId_fkey"
FOREIGN KEY ("diagnosisId") REFERENCES "Diagnosis"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AiObservation"
ADD CONSTRAINT "AiObservation_clinicId_fkey"
FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Contact"
ADD CONSTRAINT "Contact_clinicId_fkey"
FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Session"
ADD CONSTRAINT "Session_contactId_fkey"
FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
