-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AiObservation" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "measurementAt" DATETIME NOT NULL,
    "capturedAt" DATETIME NOT NULL,
    "evidence" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "measurementStatus" TEXT,
    "unavailableReason" TEXT,
    "measurementMetaJson" TEXT,
    "provisional" BOOLEAN NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiObservation_diagnosisId_fkey" FOREIGN KEY ("diagnosisId") REFERENCES "Diagnosis" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AiObservation_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_AiObservation" ("capturedAt", "citationsJson", "clinicId", "competitorsJson", "createdAt", "diagnosisId", "evidence", "id", "measurementAt", "mention", "model", "patientQuestion", "provider", "provisional", "rank", "region", "sourceType") SELECT "capturedAt", "citationsJson", "clinicId", "competitorsJson", "createdAt", "diagnosisId", "evidence", "id", "measurementAt", "mention", "model", "patientQuestion", "provider", "provisional", "rank", "region", "sourceType" FROM "AiObservation";
DROP TABLE "AiObservation";
ALTER TABLE "new_AiObservation" RENAME TO "AiObservation";
UPDATE "AiObservation"
SET "measurementStatus" = 'reference'
WHERE "sourceType" = 'mock';
CREATE INDEX "AiObservation_diagnosisId_idx" ON "AiObservation"("diagnosisId");
CREATE INDEX "AiObservation_clinicId_idx" ON "AiObservation"("clinicId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
