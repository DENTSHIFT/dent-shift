-- DATA_MODEL.mdのclinics.contact_emailに対応する医院代表連絡先。
-- 既存Clinicを壊さず段階導入できるようnullableで追加する。
ALTER TABLE "Clinic" ADD COLUMN "contactEmail" TEXT;
