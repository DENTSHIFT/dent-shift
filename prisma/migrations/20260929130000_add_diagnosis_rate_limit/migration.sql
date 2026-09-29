-- CreateTable
CREATE TABLE "DiagnosisRateLimitState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scopeType" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "windowStartedAt" DATETIME NOT NULL,
    "countInWindow" INTEGER NOT NULL DEFAULT 0,
    "inFlightSince" DATETIME,
    "executionId" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "DiagnosisIdempotencyLock" (
    "clientRequestId" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL,
    "diagnosisId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "principalKey" TEXT NOT NULL DEFAULT '',
    "inputHash" TEXT NOT NULL DEFAULT '',
    "executionId" TEXT
);

-- CreateIndex
CREATE UNIQUE INDEX "DiagnosisRateLimitState_scopeType_scopeKey_key" ON "DiagnosisRateLimitState"("scopeType", "scopeKey");

-- CreateIndex
CREATE INDEX "DiagnosisIdempotencyLock_createdAt_idx" ON "DiagnosisIdempotencyLock"("createdAt");
