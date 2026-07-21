-- One-time cleanup: null out mileageKm values outside the physical plausibility
-- range [0, 2_000_000]. Values > 2_000_000 km were produced by a prior parseKm
-- bug that concatenated year/engine digits into the odometer reading.
-- New rows are protected by the mileageKm > 2_000_000 guard in writeLead
-- (scripts/ingestion/write-lead.ts) so this migration runs exactly once.
UPDATE "Car"
SET "mileageKm" = NULL
WHERE "mileageKm" > 2000000 OR "mileageKm" < 0;
