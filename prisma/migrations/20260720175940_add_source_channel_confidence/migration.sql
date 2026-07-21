-- AlterTable: add sourceChannel and confidence columns to Car
ALTER TABLE "Car" ADD COLUMN "sourceChannel" TEXT NOT NULL DEFAULT 'classifieds';
ALTER TABLE "Car" ADD COLUMN "confidence" TEXT NOT NULL DEFAULT 'high';

-- Backfill: auction platforms → sourceChannel = 'auction_house'
-- (OLX rows keep the 'classifieds' default; no UPDATE needed)
UPDATE "Car" SET "sourceChannel" = 'auction_house' WHERE "sourcePlatform" = 'Bradesco Vitrine';
UPDATE "Car" SET "sourceChannel" = 'auction_house' WHERE "sourcePlatform" = 'VIP Leilões';
UPDATE "Car" SET "sourceChannel" = 'auction_house' WHERE "sourcePlatform" = 'BIDchain';
UPDATE "Car" SET "sourceChannel" = 'auction_house' WHERE "sourcePlatform" = 'MGL';
UPDATE "Car" SET "sourceChannel" = 'auction_house' WHERE "sourcePlatform" = 'Santander Retomados';
