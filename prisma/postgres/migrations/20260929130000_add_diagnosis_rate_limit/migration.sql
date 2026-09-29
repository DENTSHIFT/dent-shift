-- CreateTable
CREATE TABLE "DiagnosisRateLimitState" (
    "id" TEXT NOT NULL,
    "scopeType" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "windowStartedAt" TIMESTAMP(3) NOT NULL,
    "countInWindow" INTEGER NOT NULL DEFAULT 0,
    "inFlightSince" TIMESTAMP(3),
    "executionId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiagnosisRateLimitState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiagnosisIdempotencyLock" (
    "clientRequestId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "diagnosisId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "DiagnosisIdempotencyLock_pkey" PRIMARY KEY ("clientRequestId")
);

-- CreateIndex
CREATE UNIQUE INDEX "DiagnosisRateLimitState_scopeType_scopeKey_key" ON "DiagnosisRateLimitState"("scopeType", "scopeKey");

-- CreateIndex
CREATE INDEX "DiagnosisIdempotencyLock_createdAt_idx" ON "DiagnosisIdempotencyLock"("createdAt");
