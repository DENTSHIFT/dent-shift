-- 医院の代表電話。患者個人情報ではなく、既存行との互換性のためnullableで追加する。
ALTER TABLE "Clinic" ADD COLUMN "contactPhone" TEXT;
