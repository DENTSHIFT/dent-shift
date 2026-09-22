-- CreateTable
CREATE TABLE "ImprovementActionSelfServeMark" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "contactId" TEXT,
    "reportId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "improvementActionKey" TEXT NOT NULL,
    "markedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImprovementActionSelfServeMark_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImprovementActionSelfServeMark_clinicId_idx" ON "ImprovementActionSelfServeMark"("clinicId");

-- CreateIndex
CREATE UNIQUE INDEX "ImprovementActionSelfServeMark_reportId_version_improvementActionKey_key" ON "ImprovementActionSelfServeMark"("reportId", "version", "improvementActionKey");

-- AddForeignKey
ALTER TABLE "ImprovementActionSelfServeMark" ADD CONSTRAINT "ImprovementActionSelfServeMark_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImprovementActionSelfServeMark" ADD CONSTRAINT "ImprovementActionSelfServeMark_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImprovementActionSelfServeMark" ADD CONSTRAINT "ImprovementActionSelfServeMark_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Diagnosis"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
