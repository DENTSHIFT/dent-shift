-- CreateTable
CREATE TABLE "OptionProduct" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deliveryType" TEXT NOT NULL,
    "priceJpy" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'jpy',
    "stripeProductId" TEXT,
    "stripePriceId" TEXT,
    "requiresPayment" BOOLEAN NOT NULL DEFAULT true,
    "requiresHumanReview" BOOLEAN NOT NULL DEFAULT false,
    "requiresExplicitPublishApproval" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "OptionOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clinicId" TEXT NOT NULL,
    "contactId" TEXT,
    "productId" TEXT NOT NULL,
    "productKey" TEXT NOT NULL,
    "improvementActionKey" TEXT,
    "reportId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "includedByPlan" BOOLEAN NOT NULL DEFAULT false,
    "amountJpy" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'jpy',
    "planSnapshot" TEXT,
    "priceSnapshot" INTEGER,
    "stripeCheckoutSessionId" TEXT,
    "stripePaymentIntentId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" DATETIME,
    "refundedAt" DATETIME,
    CONSTRAINT "OptionOrder_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "OptionOrder_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "OptionOrder_productId_fkey" FOREIGN KEY ("productId") REFERENCES "OptionProduct" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "OptionOrder_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Diagnosis" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GeneratedArtifact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "generationStatus" TEXT NOT NULL DEFAULT 'pending',
    "storageRef" TEXT,
    "passwordHash" TEXT,
    "passwordEncrypted" TEXT,
    "generatedAt" DATETIME,
    "expiresAt" DATETIME,
    "downloadedAt" DATETIME,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GeneratedArtifact_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "OptionOrder" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GeneratedArtifact_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PlanEntitlementUsage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clinicId" TEXT NOT NULL,
    "entitlementKey" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "includedQuantity" INTEGER NOT NULL,
    "usedQuantity" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PlanEntitlementUsage_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ClinicAuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clinicId" TEXT NOT NULL,
    "contactId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "metadataJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClinicAuditLog_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ClinicAuditLog_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "OptionProduct_key_key" ON "OptionProduct"("key");

-- CreateIndex
CREATE UNIQUE INDEX "OptionOrder_stripeCheckoutSessionId_key" ON "OptionOrder"("stripeCheckoutSessionId");

-- CreateIndex
CREATE INDEX "OptionOrder_clinicId_idx" ON "OptionOrder"("clinicId");

-- CreateIndex
CREATE INDEX "OptionOrder_status_idx" ON "OptionOrder"("status");

-- CreateIndex
CREATE UNIQUE INDEX "OptionOrder_reportId_version_productKey_key" ON "OptionOrder"("reportId", "version", "productKey");

-- CreateIndex
CREATE UNIQUE INDEX "GeneratedArtifact_orderId_key" ON "GeneratedArtifact"("orderId");

-- CreateIndex
CREATE INDEX "GeneratedArtifact_clinicId_idx" ON "GeneratedArtifact"("clinicId");

-- CreateIndex
CREATE UNIQUE INDEX "PlanEntitlementUsage_clinicId_entitlementKey_period_key" ON "PlanEntitlementUsage"("clinicId", "entitlementKey", "period");

-- CreateIndex
CREATE INDEX "ClinicAuditLog_clinicId_idx" ON "ClinicAuditLog"("clinicId");

-- CreateIndex
CREATE INDEX "ClinicAuditLog_targetType_targetId_idx" ON "ClinicAuditLog"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "ClinicAuditLog_createdAt_idx" ON "ClinicAuditLog"("createdAt");
