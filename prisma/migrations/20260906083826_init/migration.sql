-- CreateTable
CREATE TABLE "Clinic" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "gbpUrl" TEXT,
    "bookingUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Diagnosis" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clinicId" TEXT NOT NULL,
    "totalPoints" INTEGER NOT NULL,
    "totalStatus" TEXT NOT NULL,
    "scoreBreakdownJson" TEXT NOT NULL,
    "competitorsJson" TEXT NOT NULL,
    "questionResultsJson" TEXT NOT NULL,
    "improvementTasksJson" TEXT NOT NULL,
    "dataDisclaimer" TEXT NOT NULL,
    "measuredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "adComplianceChecksJson" TEXT NOT NULL DEFAULT '{"findings":[],"disclaimer":"","checkedAt":""}',
    "isSample" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "Diagnosis_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AiObservation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "diagnosisId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientQuestion" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "mention" BOOLEAN NOT NULL,
    "rank" INTEGER,
    "citationsJson" TEXT NOT NULL,
    "competitorsJson" TEXT NOT NULL,
    "region" TEXT,
    "measurementAt" DATETIME NOT NULL,
    "capturedAt" DATETIME NOT NULL,
    "evidence" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "provisional" BOOLEAN NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiObservation_diagnosisId_fkey" FOREIGN KEY ("diagnosisId") REFERENCES "Diagnosis" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AiObservation_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clinicId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'owner',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Contact_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Session" (
    "token" TEXT NOT NULL PRIMARY KEY,
    "contactId" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Session_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "AiObservation_diagnosisId_idx" ON "AiObservation"("diagnosisId");

-- CreateIndex
CREATE INDEX "AiObservation_clinicId_idx" ON "AiObservation"("clinicId");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_email_key" ON "Contact"("email");
