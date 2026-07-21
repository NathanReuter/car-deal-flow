-- One-time backfill: downgrade OLX rows from confidence=high to confidence=medium.
-- OLX ads are user-generated classifieds and do not carry the data quality signals
-- (structured fields, verified price, dealer history) that justify high confidence.
-- The DB is near-empty today so this is effectively a no-op on the current dataset
-- but will apply correctly to any real OLX rows that exist or are rolled forward.
UPDATE "Car"
SET "confidence" = 'medium'
WHERE "sourcePlatform" = 'OLX';
