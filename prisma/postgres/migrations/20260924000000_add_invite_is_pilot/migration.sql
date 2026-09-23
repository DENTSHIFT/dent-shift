-- AlterTable
ALTER TABLE "Invite" ADD COLUMN "isPilot" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: 既存のcampaign='pilot'招待をisPilot=trueに引き継ぐ
UPDATE "Invite" SET "isPilot" = true WHERE "campaign" = 'pilot';
